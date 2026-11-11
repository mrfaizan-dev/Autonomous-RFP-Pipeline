import sys
import os
import signal
import subprocess
import logging
import time
import sys
import os
import asyncio
import nodriver as uc
import random
import html2text
from bs4_engine import chtm
import multiprocessing
import queue



async def scrape_heavy_sites(url):
    print(f"🚀 Launching stealth browser for: {url}")
    
    browser = await uc.start(
        headless=True,
    )
    
    try:
        page = await asyncio.wait_for(
            browser.get(url),
            timeout=30
        )
        print("⏳ Waiting for page to mimic human behavior...")
        await asyncio.sleep(random.uniform(5.0, 8.0))

        print("📜 Scrolling page...")
        await asyncio.wait_for(
            page.scroll_down(150),
            timeout=15
        )
        await asyncio.sleep(random.uniform(2.0, 4.0))
        content = await asyncio.wait_for(
            page.get_content(),
            timeout=15
        )
                
        data_length = len(content) if content else 0
        
        if data_length > 50000:
            print(f"✅ Success! Data fetched. Length: {data_length}")
            return content
        else:
            print(f"⚠️ Content too short ({data_length}). Cloudflare challenged.")
            return None
            
    except Exception as e:
        print(f"❌ Error occurred: {e}")
    finally:
        browser.stop()

def _run_nodriver_isolated(url, queue):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        res = loop.run_until_complete(scrape_heavy_sites(url))
        queue.put(res)
    except Exception as e:
        queue.put(None)
    finally:
        loop.close()

def kill_process_tree(pid):

    try:
        if not pid:
            return

        if os.name == "nt":
            # Windows: terminate the process and its complete child tree.
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10
            )
            return

        # POSIX: get the process tree using the system's ps command.
        result = subprocess.run(
            ["ps", "-eo", "pid=,ppid="],
            capture_output=True,
            text=True,
            check=True,
            timeout=5
        )

        children_by_parent = {}
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) == 2:
                child_pid, parent_pid = map(int, parts)
                children_by_parent.setdefault(parent_pid, []).append(child_pid)

        # Collect all descendants, including nested browser processes.
        descendants = []
        seen = {int(pid)}
        stack = [(int(pid), 0)]

        while stack:
            parent_pid, depth = stack.pop()
            for child_pid in children_by_parent.get(parent_pid, []):
                if child_pid not in seen:
                    seen.add(child_pid)
                    descendants.append((depth + 1, child_pid))
                    stack.append((child_pid, depth + 1))

        # Terminate descendants from deepest to shallowest.
        descendants.sort(reverse=True)
        child_pids = [child_pid for _, child_pid in descendants]

        for child_pid in child_pids:
            try:
                os.kill(child_pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

        # Give child processes up to 3 seconds to exit gracefully.
        pending = set(child_pids)
        deadline = time.monotonic() + 3

        while pending and time.monotonic() < deadline:
            for child_pid in list(pending):
                try:
                    os.kill(child_pid, 0)
                except ProcessLookupError:
                    pending.discard(child_pid)
                except PermissionError:
                    pass

            if pending:
                time.sleep(0.1)

        # Force-kill any descendants that did not exit.
        for child_pid in pending:
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        # Terminate the main worker process, matching the previous cleanup.
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            return

        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                os.kill(int(pid), 0)
            except ProcessLookupError:
                return
            except PermissionError:
                pass
            time.sleep(0.1)

        try:
            os.kill(int(pid), signal.SIGKILL)
        except ProcessLookupError:
            pass

    except Exception:
        logging.exception(
            "Process tree cleanup failed"
        )


def sp3(url):

    ctx = multiprocessing.get_context("spawn")
    result_queue = ctx.Queue(maxsize=1)

    process = ctx.Process(
        target=_run_nodriver_isolated,
        args=(url, result_queue)
    )
    started = False

    try:
        process.start()
        started = True
        process.join(timeout=65)

        if process.is_alive():
            kill_process_tree(process.pid)
            process.join(timeout=5)

            if process.is_alive():
                process.kill()
                process.join(timeout=5)

            return None

        try:
            return result_queue.get(timeout=3)
        except queue.Empty:
            return None

    finally:
        result_queue.close()
        result_queue.join_thread()
        if started and not process.is_alive():
            process.close()


async def main():
    html_output = await asyncio.to_thread(
        sp3,
        "https://www.fiverr.com/gigs/rag-ai"
    )

    if html_output:
        chtm_output = chtm(html_output)
        print(chtm_output)
    else:
        print("Scraping failed.")

if __name__ == "__main__":
    asyncio.run(main())


