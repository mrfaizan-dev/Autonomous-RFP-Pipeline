import os, time, random
from playwright.async_api import async_playwright, Error as pe
import asyncio
from seleniumbase import SB
import logging
import uuid
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from scraping_retr import sp2
from bs4_engine import chtm
from scraping_retr_2 import sp3
import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)



url_limit = 5

user_agents = [
    # Chrome 131 - Windows
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
        }
    },
    # Chrome 131 - macOS
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"'
        }
    },
    # Microsoft Edge 131 - Windows
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        "headers": {
            "sec-ch-ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
        }
    },
    # Microsoft Edge 131 - macOS
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        "headers": {
            "sec-ch-ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"'
        }
    },
    # Chrome 130 - Windows
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
        }
    },
    # Chrome 130 - macOS
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"'
        }
    },
    # Microsoft Edge 130 - Windows
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        "headers": {
            "sec-ch-ua": '"Microsoft Edge";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
        }
    },
    # Chrome 129 - Windows (Older but highly trusted)
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Chromium";v="129", "Not = A;Brand";v="99", "Google Chrome";v="129"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"'
        }
    },
    # Chrome 128 - macOS
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"'
        }
    },
    # Chrome 131 - Linux
    {
        "ua": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "headers": {
            "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"'
        }
    }
]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
url_limit = 10
args = '--disable-blink-features=AutomationControlled,--no-first-run,--no-service-autorun,--password-store=basic,--start-maximized,--no-sandbox,--disable-dev-shm-usage'

async def engine(url, browser, semaphore, max_retries=2):
    
    async with semaphore:
        for attempt in range(1, max_retries + 1):
            context = None
            try:
                ua_config = random.choice(user_agents)
                
                context = await browser.new_context(
                    user_agent=ua_config["ua"],
                    extra_http_headers=ua_config["headers"],
                    viewport={"width": 1280, "height": 800},
                                   
                    )
                                                                                                                                                                                                                                                                                                                                                                
                page = await context.new_page()
                page.set_default_timeout(15000)
                page.set_default_navigation_timeout(45000)

                # try:
                #     async def route_bypass(route):
                #         req_type = route.request.resource_type
                #         if req_type in ["document", "script", "fetch", "xhr", "stylesheet" , "image"]:
                #             await route.continue_()
                #         else:
                #             await route.abort()
                #     await page.route("**/*" , route_bypass)
                # except Exception as e:
                #     logging.info(f"Route Intercept Error: {e}")
                
                logging.info(f"Attempt {attempt}/{max_retries} - Ready To Go To The Url: {url}")
                await page.goto(
                    url,
                    timeout=45000,
                    wait_until="domcontentloaded"
                            )

                
                await asyncio.sleep(random.uniform(3.0 , 6.0))
                await page.mouse.move(random.randint(100, 600), random.randint(100, 600))
                await asyncio.wait_for(
                            page.evaluate(
                                "window.scrollBy(0, window.innerHeight / 2);"
                            ),
                            timeout=10
                        )
                await asyncio.sleep(random.uniform(1.0 , 2.0))
                
                web_data = await asyncio.wait_for(
                        page.content(),
                        timeout=15
                                         )
                data_length = len(web_data) if web_data else 0

                #===========
                page_title = (
                    await asyncio.wait_for(
                        page.title(),
                        timeout=5
                    )
                ).lower()
                

                page_text_lower = await page.locator("body").inner_text(
                        timeout=10000
                    )
                captcha_keywords = [
                    "cloudflare", "verify you are human", "checking your browser", 
                    "access denied", "robot", "captcha", "attention required", 
                    "security check", "403 forbidden", "just a moment"
                ]

                is_captcha_detected = any(keyword in page_text_lower for keyword in captcha_keywords) or any(keyword in page_title for keyword in       captcha_keywords)

                #===========

                
                if data_length > 5000 and not is_captcha_detected:
                    logging.info(f"✅ Web Data Length okay ({data_length}). Proceeding to extract.")
                    all_data = await asyncio.to_thread(
                        chtm,
                        web_data
                                    )
                  
                    return {"status": "Success", "clean_data": all_data}
                else:
                    logging.info(f"⚠️ Web Data Length too short ({data_length}). Ready to retry...")

                    
                    
            except asyncio.CancelledError:
                    raise

            except Exception as e:
                logging.exception(
                    "Attempt %s failed for %s",
                    attempt,
                    url
                )

            finally:
                if context is not None:
                    try:
                        await asyncio.wait_for(
                            context.close(),
                            timeout=10
                        )
                    except Exception:
                        logging.exception(
                            "Context cleanup failed: %s",
                            url
                        )
            
            if attempt < max_retries:
                await asyncio.sleep(random.uniform(2.5 , 3.5))

        logging.info(f"🚫 Max Retries Reached for URL: {url}. Now trying sp2 (fallback)...")
        
        try:
            try:
                web_data = await asyncio.wait_for(
                    sp2(url),
                    timeout=100
                )

            except asyncio.CancelledError:
                raise

            except Exception:
                logging.exception(
                    "SP2 fallback failed: %s",
                    url
                )
                web_data = None
            data_length = len(web_data) if web_data else 0

            web_data_lower = web_data.lower() if web_data else ""

            # captcha_keywords = [
            #     "cloudflare", "verify you are human", "checking your browser", 
            #     "access denied", "robot", "captcha", "attention required", 
            #     "security check", "403 forbidden", "just a moment"
            # ]
            
            # is_captcha_detected = any(keyword in web_data_lower for keyword in captcha_keywords)
            
            if data_length > 5000:
                logging.info(f"✅ Data retrieved via sp2 fallback ({data_length}). Extracting data.")
                all_data = await asyncio.to_thread(
                    chtm,
                    web_data
                )
                return {"status": "Success", "clean_data": all_data}
            else:
                logging.info(f"⚠️ sp2 Fallback page contains Captcha/Block! Trying sp3...")
                logging.info(f"⚠️ Data retrieved via sp2 was too short ({data_length}). Trying sp3...")
                
                web_data = await asyncio.to_thread(sp3, url)
                
                data_length = len(web_data) if web_data else 0
                if not isinstance(web_data, str) or not web_data.strip():

                    logging.warning(
                        "Nodriver returned empty response: %s",
                        url
                    )

                    return {
                        "status": "Fail",
                        "clean_data": "",
                        "error": "Nodriver returned empty response."
                    }
                if len(web_data) <= 5000:

                    logging.warning(
                        "Nodriver response too short: %s",
                        url
                    )

                    return {
                        "status": "Fail",
                        "clean_data": "",
                        "error": "Nodriver response too short."
                    }


                all_data = await asyncio.to_thread(
                    chtm,
                    web_data
                )

                return {
                    "status": "Success",
                    "clean_data": all_data
                }

        except Exception as e:
            logging.info(f"❌ sp2 Fallback Error on Url: {e}")

        return {"status": "Fail", "all_data": "Max retries reached and sp2 fallback also failed."}

async def run_engine_with_timeout(
    url,
    browser,
    semaphore
):
    try:
        return await asyncio.wait_for(
            engine(url, browser, semaphore),
            timeout=240
        )

    except asyncio.TimeoutError:
        logging.error(
            "URL overall timeout: %s",
            url
        )

        return {
            "status": "Fail",
            "clean_data": "",
            "error": "URL overall timeout"
        }

def main(urls: list[str]):
    all_final_results = []
    with SB(uc=True, headless=True, chromium_arg=args) as sb:
        sb.activate_cdp_mode()
        endpoint_url = sb.get_endpoint_url()
        
        loop = sb.driver.cdp.loop  # type: ignore
        
        for i in range(0, len(urls), url_limit):
            batch = urls[i:i + url_limit]
            logging.info(f"Starting batch of {len(batch)} URLs")
            
            async def run_batch():
                async with async_playwright() as p:
                    browser = await p.chromium.connect_over_cdp(endpoint_url)

                    semaphore = asyncio.Semaphore(url_limit)
                    tasks = [
                            run_engine_with_timeout(
                                url,
                                browser,
                                semaphore
                            )
                            for url in batch
                        ]
                    return await asyncio.gather(*tasks)
                
            results = loop.run_until_complete(run_batch())
            all_final_results.extend(results)
            
            if i + url_limit < len(urls):
                logging.info("Batch complete. Waiting 15 seconds before next batch...")
                time.sleep(15)
                
    logging.info("All URLs scraped. Proceeding to save user data securely...")

    return {"status": "Success", "raw_data": all_final_results}



if __name__ == "__main__":
    main(["https://www.upwork.com/freelance-jobs/artificial-intelligence/"])
    
    # 4. Completely removed asyncio.run from here, called main() directly
#     main(["https://www.walmart.com/search?q=shampoo",
# "https://www.amazon.com/s?k=watch",
# "https://www.ebay.com/sch/i.html?_nkw=pc&_sacat=0&_from=R40&_trksid=p2334524.m570.l1313&_odkw=0pc&_osacat=0"

# , "https://www.etsy.com/search?q=Embroidered+clothing",
# "https://www.daraz.pk/catalog/?spm=a2a0e.tm80335142.search.d_go&q=shoes"] , scrape_for="ecommerce"

# )
