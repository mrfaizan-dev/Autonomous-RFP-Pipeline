import asyncio
import random
import logging
from playwright.async_api import async_playwright

async def human_move_mouse(page, start_x, start_y, end_x, end_y):
    """Simulates natural mouse movement."""
    steps = 30
    duration = 1.0
    step_duration = duration / steps
    import math
    
    for i in range(steps):
        t = i / steps
        noise_x = math.sin(t * 10) * 0.1
        noise_y = math.cos(t * 10) * 0.1
        
        current_x = start_x + (end_x - start_x) * t + noise_x
        current_y = start_y + (end_y - start_y) * t + noise_y
        
        await page.mouse.move(current_x, current_y)
        await asyncio.sleep(step_duration)

async def simulate_scroll(page):
    """Scrolls down slowly to trigger content load."""
    try:
        await page.evaluate("""
            async () => {
                await new Promise((resolve) => {
                    let totalScroll = 0;
                    const timer = setInterval(() => {
                        const scrollStep = Math.random() * 200 + 100;
                        window.scrollBy(0, scrollStep);
                        totalScroll += scrollStep;
                        if (totalScroll >= document.body.scrollHeight || totalScroll > 3000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 200);
                });
            }
        """)
    except asyncio.CancelledError:
        raise

    except Exception:
        logging.exception(
            "SP2 scrolling failed"
        )
        raise

async def sp2(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--window-size=1920,1080'
            ]
        )
        try:
        
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                locale='en-US',
                timezone_id='America/New_York'
            )
            
            page = await context.new_page()
            
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(window, 'chrome', {
                    get: () => ({ app: { isInstalled: false }, csi: () => {}, loadTimes: () => {} })
                });
            """)
            
            await page.goto(url, wait_until='domcontentloaded', timeout=60000)
            await asyncio.sleep(4)
            
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass

            await asyncio.wait_for(
                    simulate_scroll(page),
                    timeout=12
                                  )
            await asyncio.wait_for(
                human_move_mouse(
                    page,
                    100,
                    100,
                    500,
                    300
                ),
                timeout=10
            )
            await asyncio.sleep(2)
            
            web_data = await asyncio.wait_for(
            page.content(),
            timeout=15
        )
            return web_data
        except Exception as e:
            print(f"sp2 Error on URL: {e}")
            return None
        finally:
            try:
                await asyncio.wait_for(
                    browser.close(),
                    timeout=10
                )

            except asyncio.CancelledError:
                raise

            except Exception:
                logging.exception(
                    "SP2 browser cleanup failed"
                )

if __name__ == "__main__":
    asyncio.run(sp2("https://www.walmart.com/search?q=shampoo"))
