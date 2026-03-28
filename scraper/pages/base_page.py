import random
import time
from config.settings import MIN_DELAY, MAX_DELAY, SCROLL_MIN_DELAY, SCROLL_MAX_DELAY

class BasePage:
    def __init__(self, page):
        self.page = page
        self.min_delay = MIN_DELAY
        self.max_delay = MAX_DELAY

    def human_delay(self, min_seconds=None, max_seconds=None):
        """Add a random human-like delay"""
        min_delay = min_seconds or self.min_delay
        max_delay = max_seconds or self.max_delay
        delay = random.uniform(min_delay, max_delay)
        time.sleep(delay)
        return delay

    def random_scroll(self, min_amount=-200, max_amount=200):
        """Perform random scrolling to simulate human behavior"""
        scroll_amount = random.randint(min_amount, max_amount)
        self.page.evaluate(f"window.scrollBy(0, {scroll_amount})")
        time.sleep(random.uniform(SCROLL_MIN_DELAY, SCROLL_MAX_DELAY))

    def human_mouse_movement(self, selector):
        """Simulate human-like mouse movement to an element"""
        try:
            element = self.page.locator(selector)
            if element.count() > 0:
                # Move mouse to element with slight randomness
                element.hover()
                # Add small random movement
                self.page.mouse.move(
                    random.randint(-3, 3), 
                    random.randint(-3, 3)
                )
                time.sleep(random.uniform(0.1, 0.3))
        except Exception as e:
            print(f"Mouse movement failed: {e}")

    def scroll_to_bottom(self):
        """Scroll to bottom with human-like behavior"""
        self.page.evaluate("window.scrollBy(0, document.body.scrollHeight)")
        self.human_delay(1, 2)
