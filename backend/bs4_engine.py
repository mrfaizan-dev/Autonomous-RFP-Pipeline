from bs4 import BeautifulSoup
import html2text
import re

def chtm(html_content):
    if not html_content:
        print("⚠️ HTML content khali hai!")
        return None

    soup = BeautifulSoup(html_content, 'html.parser')
    
    unwanted_tags = ["nav", "footer", "header", "script", "style", "aside", "form", "iframe", "noscript"]
    for element in soup(unwanted_tags):
        element.decompose()
        
    for noise in soup.find_all(class_=["cookie-banner", "sidebar", "ads", "social-share", "navigation"]):
        noise.decompose()

    clean_html_str = str(soup)

    converter = html2text.HTML2Text()
    converter.ignore_links = True
    converter.ignore_images = True      
    converter.ignore_emphasis = False   
    converter.body_width = 0           

    markdown_text = converter.handle(clean_html_str)
    if not markdown_text:
        return ""
    text = re.sub(r'\n\s*\n', '\n\n', markdown_text)

    text = re.sub(r'[ \t]+', ' ', text)

    optimized_text = text.strip()
    
    return optimized_text

