import os
import random
import time
from .base_page import BasePage
from config.settings import (
    MIN_DELAY, MAX_DELAY, TYPING_MIN_DELAY, TYPING_MAX_DELAY, 
    SCROLL_MIN_DELAY, SCROLL_MAX_DELAY, SECURITY_CHALLENGE_WAIT
)

class LinkedInLoginPage(BasePage):
    def __init__(self, page):
        super().__init__(page)
        self.min_delay = MIN_DELAY
        self.max_delay = MAX_DELAY
    
    def human_delay(self, min_seconds=None, max_seconds=None):
        """Add a random human-like delay"""
        min_delay = min_seconds or self.min_delay
        max_delay = max_seconds or self.max_delay
        delay = random.uniform(min_delay, max_delay)
        time.sleep(delay)
        return delay
    
    def human_type(self, selector, text, min_delay=None, max_delay=None):
        """Simulate human-like typing with random delays between characters"""
        min_delay = min_delay or TYPING_MIN_DELAY
        max_delay = max_delay or TYPING_MAX_DELAY
        
        # Clear the field first
        self.page.fill(selector, "")
        
        # Type each character with random delays
        for char in text:
            self.page.type(selector, char, delay=random.uniform(min_delay, max_delay))
            # Add occasional longer pauses (like a human thinking)
            if random.random() < 0.1:  # 10% chance
                time.sleep(random.uniform(0.2, 0.5))
    
    def human_mouse_movement(self, selector):
        """Simulate human-like mouse movement to an element"""
        # Get element position
        element = self.page.locator(selector)
        if element.count() > 0:
            # Move mouse to element with slight randomness; use .first to avoid
            # strict-mode violations when a selector matches multiple elements
            element.first.hover()
            # Add small random movement
            self.page.mouse.move(
                random.randint(-5, 5), 
                random.randint(-5, 5)
            )
            time.sleep(random.uniform(0.1, 0.3))
    
    def random_scroll(self):
        """Perform random scrolling to simulate human behavior"""
        scroll_amount = random.randint(-300, 300)
        self.page.evaluate(f"window.scrollBy(0, {scroll_amount})")
        time.sleep(random.uniform(SCROLL_MIN_DELAY, SCROLL_MAX_DELAY))
    
    def _screenshot(self, name="debug"):
        """Always save a screenshot — used for CI artifact upload."""
        try:
            import os
            os.makedirs("screenshots", exist_ok=True)
            path = f"screenshots/{name}.png"
            self.page.screenshot(path=path, full_page=True)
            print(f"📸 Screenshot saved: {path}")
        except Exception as e:
            print(f"⚠️ Screenshot failed: {e}")

    def _handle_cookie_consent(self):
        """Accept LinkedIn's cookie-consent banner if it appears before the login form."""
        consent_selectors = [
            "button[action-type='ACCEPT']",
            "button[data-tracking-control-name*='accept']",
            "button[data-test-id*='accept']",
            ".artdeco-global-alert button",
            "button.accept-cookies",
            "button:has-text('Accept')",
            "button:has-text('Allow')",
        ]
        for sel in consent_selectors:
            try:
                btn = self.page.locator(sel)
                if btn.count() > 0:
                    print(f"🍪 Cookie consent detected ({sel}), accepting...")
                    btn.first.click()
                    self.page.wait_for_load_state("domcontentloaded", timeout=8000)
                    print(f"   URL after consent: {self.page.url}")
                    return
            except Exception:
                pass

    def load(self):
        print("Loading LinkedIn login page...")
        self.page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

        print(f"   URL after load  : {self.page.url}")
        print(f"   Page title      : {self.page.title()}")
        self._screenshot("01_after_load")

        # Accept cookie consent if LinkedIn shows it before the login form
        self._handle_cookie_consent()

        self.human_delay(1, 2)
        self.random_scroll()
        print("Login page loaded")
    
    def login(self, username, password):
        print("Attempting to login with human-like behavior...")
        
        print(f"   URL before form search : {self.page.url}")
        print(f"   Page title             : {self.page.title()}")

        # Re-handle cookie consent in case it appeared after load()
        self._handle_cookie_consent()

        username_selector = None
        for sel in [
            "input#username",
            "input[name='session_key']",
            "input[autocomplete='username']",
            "input[autocomplete='email']",
            "input[type='email']",
            "input[type='text']",
            "input",
        ]:
            try:
                self.page.wait_for_selector(sel, timeout=8000)
                username_selector = sel
                print(f"Username field found with selector: {sel}")
                break
            except Exception:
                continue

        if username_selector is None:
            self._screenshot("02_login_form_not_found")
            # Log page source snippet to help diagnose what LinkedIn actually showed
            try:
                snippet = self.page.content()[:2000]
                print(f"⚠️ Page source (first 2000 chars):\n{snippet}")
            except Exception:
                pass
            raise Exception(
                f"Could not find username field. URL={self.page.url} title='{self.page.title()}'"
            )

        # Human-like behavior before filling credentials
        self.human_delay(1, 2)
        self.random_scroll()

        # Fill username with human-like typing
        print("Typing username...")
        self.human_mouse_movement(username_selector)
        self.human_type(username_selector, username)
        print("Username entered")
        
        # Human-like delay between fields
        self.human_delay(1.5, 3)
        
        # Fill password with human-like typing
        print("Typing password...")
        self.human_mouse_movement("input#password")
        self.human_type("input#password", password)
        print("Password entered")
        
        # Human-like delay before clicking login
        self.human_delay(2, 4)
        
        # Random scroll before clicking
        self.random_scroll()
        
        # Click login button with human-like behavior
        print("Clicking login button...")
        self.human_mouse_movement("button[type='submit']")
        self.page.click("button[type='submit']")
        print("Login button clicked")
        
        # Wait for URL to leave the login page — LinkedIn SPA never reaches
        # "networkidle" (constant background requests), so waiting for it hangs
        # for the full timeout every single time.
        try:
            self.page.wait_for_url("**/linkedin.com/**", timeout=30000)
            self.page.wait_for_load_state("domcontentloaded", timeout=10000)
            print("Page navigation completed")
        except Exception as e:
            print(f"Navigation timeout: {e}")
        
        # Additional wait for any security challenges
        self.human_delay(3, 5)
        
        # Check current URL to see where we ended up
        current_url = self.page.url
        print(f"Current URL after login: {current_url}")
        
        self._screenshot("03_after_login_click")
        
        # Check if we're on a security challenge page
        if "challenge" in current_url or "checkpoint" in current_url:
            print("🔒 LinkedIn security challenge detected")
            print("Attempting to handle security challenge...")
            
            # Wait longer for security challenge to load
            self.human_delay(5, 8)
            
            # Check if we can find security challenge elements
            try:
                # Look for common security challenge elements
                security_selectors = [
                    "input[type='text']",
                    "input[type='email']",
                    "input[type='tel']",
                    "button[type='submit']",
                    ".challenge-dialog",
                    "[data-test-id='challenge-dialog']"
                ]
                
                for selector in security_selectors:
                    if self.page.locator(selector).count() > 0:
                        print(f"Found security challenge element: {selector}")
                        break
                
                print("⚠️ Manual intervention may be required for security challenge")
                print("Please check the screenshot and handle the challenge manually")
                
                # Wait for user to handle challenge
                print(f"Waiting {SECURITY_CHALLENGE_WAIT} seconds for manual challenge resolution...")
                time.sleep(SECURITY_CHALLENGE_WAIT)
                
                # Check URL again
                current_url = self.page.url
                print(f"URL after challenge wait: {current_url}")
                
            except Exception as e:
                print(f"Error handling security challenge: {e}")
            
            # If still on challenge page, raise exception
            if "challenge" in current_url or "checkpoint" in current_url:
                raise Exception(f"Security challenge not resolved. Current URL: {current_url}")
        
        # Check if login was successful
        if "login" in current_url:
            print("❌ Login failed - still on login page")
            raise Exception(f"Login failed. Still on: {current_url}")
        
        # Try to find the search input as confirmation of successful login
        try:
            self.page.wait_for_selector("input.search-global-typeahead__input", timeout=20000)
            print("✅ Login successful! Found search input")
        except Exception as e:
            print(f"Could not find search input: {e}")
            # Try alternative selectors
            try:
                self.page.wait_for_selector("input[placeholder*='Search']", timeout=10000)
                print("✅ Login successful! Found alternative search input")
            except Exception as e2:
                print(f"Could not find alternative search input: {e2}")
                # If we're on the feed page, that's also a sign of successful login
                if "feed" in current_url or "linkedin.com" in current_url:
                    print("✅ Login appears successful (on LinkedIn main page)")
                else:
                    raise Exception("Login verification failed - could not confirm successful login")
