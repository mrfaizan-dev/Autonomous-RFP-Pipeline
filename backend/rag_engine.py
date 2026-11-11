from llama_index.core.memory import ChatMemoryBuffer
from llama_index.core import StorageContext, VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.core.schema import TextNode
from llama_index.core.node_parser import SentenceSplitter
from llama_index.readers.file import PyMuPDFReader
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.retrievers.bm25 import BM25Retriever
from llama_index.core.schema import BaseNode
from llama_index.core.prompts import PromptTemplate
from llama_index.core.chat_engine import ContextChatEngine
from llama_index.core.retrievers.fusion_retriever import QueryFusionRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.llms.gemini import Gemini
from typing import cast, List
import warnings
import time , os, random
from pydantic import Field, BaseModel
import google.genai as genai
from tenacity import retry, stop_after_attempt, wait_exponential
from typing import Optional, List, Any
import chromadb
import logging
from llama_index.llms.groq import Groq
from llama_index.core.llms import MockLLM
import asyncio



Settings.llm = MockLLM()

from dotenv import load_dotenv


#===================================
# Ignore warnings
_old_warn = warnings.warn
def safe_warn(message, category=None, stacklevel=1, source=None, *args, **kwargs):
    global _old_warn  
    if kwargs and 'skip_file_prefixes' in kwargs:
        kwargs.pop('skip_file_prefixes', None)
        
    return _old_warn(message, category, stacklevel, source, *args, **kwargs)
warnings.warn = safe_warn
warnings.filterwarnings("ignore")

#===================================


load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ==========================================
#      GEMINI EMBEDDINGS API Key Setup     #
# ==========================================
api_key = os.getenv("GEMINI_API_KEYS") or "" 
groq_api_key = os.getenv("GROQ_API_KEYS") or ""

if not api_key:
    logger.error("❌ Essential API Keys (GEMINI) missing in environment!")
    logger.error("❌ Error: Essential API Keys not found in system environment!")

# ==========================================
# 4. Gemini Embedding Class with Tenacity
# ==========================================
class GeminiTenacityEmbedding(BaseEmbedding):
    model_name: str = Field(default="gemini-embedding-001")
    api_key: str = Field(default="")

    def __init__(self, model: str = "gemini-embedding-001", api_key: str = "", **kwargs: Any):
        super().__init__(**kwargs)
        self.model_name = model
        self.api_key = api_key

    def _get_client(self) -> genai.Client:
        return genai.Client(api_key=self.api_key)

    @retry(wait=wait_exponential(min=2, max=10), stop=stop_after_attempt(5))
    def _get_query_embedding(self, query: str) -> List[float]: #type: ignore
        client = self._get_client()
        response = client.models.embed_content(model=self.model_name, contents=query)
        if hasattr(response, 'embedding') and response.embedding: #type: ignore
            return response.embedding.values #type: ignore
        return response.embeddings[0].values #type: ignore

    async def _aget_query_embedding(self, query: str) -> List[float]: #type: ignore
        return self._get_query_embedding(query)

    @retry(wait=wait_exponential(min=2, max=10), stop=stop_after_attempt(5))
    def _get_text_embedding(self, text: str) -> List[float]: #type: ignore
        client = self._get_client()
        response = client.models.embed_content(model=self.model_name, contents=text)
        if hasattr(response, 'embedding') and response.embedding: #type: ignore
            return response.embedding.values #type: ignore
        return response.embeddings[0].values #type: ignore

    async def _aget_text_embedding(self, text: str) -> List[float]: #type: ignore
        return self._get_text_embedding(text)

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]: #type: ignore
        client = self._get_client()
        embeddings_list = []
        for text in texts:
            @retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(5))
            def _embed_single_chunk(t):
                res = client.models.embed_content(model=self.model_name, contents=t)
                if hasattr(res, 'embedding') and res.embedding: #type: ignore
                    return res.embedding.values #type: ignore
                return res.embeddings[0].values #type: ignore

            if not text.strip():
                embeddings_list.append([0.0] * 768)
                continue
            embeddings_list.append(_embed_single_chunk(text))
            time.sleep(0.3)
        return embeddings_list

emb_setup = GeminiTenacityEmbedding(model="gemini-embedding-001", api_key=api_key)

# ==========================================

Settings.embed_model = emb_setup
Settings.llm = llm = Groq(model="openai/gpt-oss-20b", api_key=groq_api_key, temperature=0.0)


async def rag_setup(query: str, projects_file: str = "past_projects.md") -> str:

    try:

        storing_path = "./embeddings_Store"

        per_dir = chromadb.PersistentClient(path=storing_path)
        chroma_collection = per_dir.get_or_create_collection("company_projects_rag")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        storage_contexts = StorageContext.from_defaults(vector_store=vector_store)
        stored_data = chroma_collection.get(
                    include=["documents", "metadatas"]
                )
        
        documents = stored_data.get("documents") or []
        metadatas = stored_data.get("metadatas") or []

        all_nodes = [
            TextNode(
                text=doc,
                metadata=metadata or {}
            )
            for doc, metadata in zip(documents, metadatas)
            if doc and doc.strip()
        ]

        if not all_nodes:
            logger.info("[RAG] No active portfolio chunks found.")
            return ""

        index = VectorStoreIndex.from_vector_store(vector_store=vector_store, embed_model = emb_setup)

        vector_retr = index.as_retriever(similarity_top_k = 2)
        bm25_retr = BM25Retriever.from_defaults(nodes = cast(List[BaseNode] , all_nodes) , similarity_top_k = 2)

        custom_prompt = (
    "You are an expert search query assistant for an software house.\n"
    "Your ONLY job is to rewrite the given RFP query into exactly 1 optimized database search query.\n"
    "Do not add any explanations, commentary, or answers. Output ONLY the search query.\n"
    "Original Query: {query}\n"
    "Query 1:"
                 )

        hybrid_retriever = QueryFusionRetriever(
            retrievers = [vector_retr , bm25_retr],
            similarity_top_k = 1,
            num_queries=2,
            use_async = True,
            llm = Settings.llm,
            query_gen_prompt = custom_prompt
        )

        ans_query = await hybrid_retriever.aretrieve(query)
        context_text = "\n\n".join([node.node.get_content() for node in ans_query])
        return context_text if context_text.strip() else "No matching project found."
    
    except Exception as e:
        logger.error(f"❌ Document processing failed: {str(e)}")
        return str(f"Error in Rag Engine: {str(e)}")


async def add_or_update_rag_document(file_path: str, file_name: str) -> str:
    try:
        valid_ext = (".pdf", ".txt", ".csv", ".md")
        if not file_path.lower().endswith(valid_ext):
            raise ValueError(f"Unsupported file type: {file_path}")

        # 1. Nayi file ko load aur chunk karen
        text_split = SentenceSplitter(chunk_size=500, chunk_overlap=50)
        if file_path.lower().endswith(".pdf"):
            loader = PyMuPDFReader().load_data(file_path=file_path)
            all_nodes = text_split.get_nodes_from_documents(loader)
        else:
            reader = SimpleDirectoryReader(input_files=[file_path])
            loader = reader.load_data()
            all_nodes = text_split.get_nodes_from_documents(loader)

        for node in all_nodes:
            node.metadata["file_name"] = file_name

        storing_path = "./embeddings_Store"
        per_dir = chromadb.PersistentClient(path=storing_path)
        chroma_collection = per_dir.get_or_create_collection("company_projects_rag")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        storage_contexts = StorageContext.from_defaults(vector_store=vector_store)

        index = VectorStoreIndex.from_vector_store(vector_store=vector_store, embed_model=emb_setup)
        index.insert_nodes(all_nodes)
        
        logger.info(f"✅ Successfully added/updated {len(all_nodes)} chunks for {file_name}")
        return f"Successfully added {file_name} to RAG knowledge base!"

    except Exception as e:
        logger.error(f"❌ RAG append failed: {str(e)}")
        raise RuntimeError(f"RAG Append Error: {str(e)}")



if __name__ == "__main__":
    st = time.time()
    print(rag_setup("What is Detailed Operational Description"))
    et = time.time()
    print(f"Execution Time: {et - st} seconds")