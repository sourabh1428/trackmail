import os
import random
import time
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

LINKEDIN_EMAIL = os.getenv("LINKEDIN_EMAIL")
LINKEDIN_PASSWORD = os.getenv("LINKEDIN_PASSWORD")

from config.settings import CONTEXT_FILE, MAX_POSTS
from utils.context_manager import save_context, load_context
from pages.login_page import LinkedInLoginPage
from pages.search_page import LinkedInSearchPage

class LinkedInScraper:
	def __init__(self, browser, context_path=CONTEXT_FILE):
		self.browser = browser
		self.context_path = context_path
		
		# Validate credentials
		if not LINKEDIN_EMAIL or not LINKEDIN_PASSWORD:
			raise ValueError("LinkedIn credentials not found in .env file. Please check your .env file.")

	def human_delay(self, min_seconds=1.0, max_seconds=3.0):
		"""Add a random human-like delay"""
		delay = random.uniform(min_seconds, max_seconds)
		time.sleep(delay)
		return delay

	def scrape_multiple_links(self, links, max_workers=3, keep_tabs_open=False):
		"""
		Scrape multiple LinkedIn links with concurrent multi-tab scrolling (single-thread round-robin)
		- Opens all links in tabs within the SAME context (single login)
		- Iterates over tabs in a tight loop to scroll and collect in parallel
		- If keep_tabs_open is True, do not close tabs/context at the end
		"""
		print(f"🔗 Starting to scrape {len(links)} LinkedIn links with TRUE PARALLEL scrolling...")
		print(f"⚡ Tabs will scroll SIMULTANEOUSLY via round-robin for maximum stability!")
		
		# Ensure valid context (login)
		context = self._ensure_valid_context()
		if not context:
			print("❌ Failed to establish valid LinkedIn context")
			return {}
		
		results = {}
		pages = []
		
		try:
			# Open ALL tabs
			print("🚀 Opening ALL tabs simultaneously...")
			for i, link in enumerate(links):
				page = context.new_page()
				# Stealth
				page.add_init_script("""
					Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
					Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
					Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
				""")
				print(f"🌐 Tab {i+1}: Navigating to {link}")
				page.goto(link, timeout=30000)
				pages.append((page, link, i+1))
			print(f"✅ All {len(links)} tabs opened successfully!")
			print("🔍 Starting round-robin scrolling across all tabs...")
			
			# Per-tab state
			states = []
			for page, link, tab_index in pages:
				states.append({
					"page": page,
					"link": link,
					"tab_index": tab_index,
					"profiles": set(),
					"previous_height": None,
					"no_data_count": 0,
					"scroll_attempts": 0,
					"done": False
				})
			
			# Use configurable thresholds from settings
			from config.settings import ROUND_ROBIN_MAX_SCROLL_ATTEMPTS as MAX_SCROLL_ATTEMPTS
			from config.settings import ROUND_ROBIN_NO_DATA_THRESHOLD_ATTEMPTS as NO_DATA_THRESHOLD_ATTEMPTS
			from config.settings import CONTENT_LOAD_WAIT_TIME
			
			# Initial wait for DOM
			for s in states:
				try:
					s["page"].wait_for_load_state("domcontentloaded", timeout=15000)
				except Exception:
					pass
			
			# Round-robin loop
			active = len(states)
			while active > 0:
				for s in states:
					if s["done"]:
						continue
					page = s["page"]
					link = s["link"]
					tab_index = s["tab_index"]
					profiles = s["profiles"]
					
					try:
						# Collect emails visible now - use multiple methods
						# Method 1: mailto links
						mailto_emails = page.locator("a[href^='mailto:']").evaluate_all(
							"elements => elements.map(e => e.href.replace('mailto:', '').trim())"
						)
						
						# Method 2: Look for email patterns in text content
						text_emails = page.evaluate("""
							() => {
								const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
								const textContent = document.body.innerText;
								const matches = textContent.match(emailRegex);
								return matches ? matches.filter(email => 
									!email.includes('example.com') && 
									!email.includes('test.com') &&
									!email.includes('domain.com') &&
									email.length > 5
								) : [];
							}
						""")
						
						# Method 3: Look in specific LinkedIn elements that might contain emails
						linkedin_emails = page.locator("[data-test-id*='email'], .email, [class*='email'], [id*='email']").evaluate_all(
							"elements => elements.map(e => e.innerText).filter(text => text.includes('@'))"
						)
						
						# Combine all methods and clean up
						all_emails = set(mailto_emails + text_emails + linkedin_emails)
						current_profiles = [email.strip() for email in all_emails if email and '@' in email and '.' in email.split('@')[1]]
						
						new_profiles = set(current_profiles) - profiles
						if new_profiles:
							profiles.update(new_profiles)
							print(f"🎯 Tab {tab_index}: {len(new_profiles)} new emails. Total: {len(profiles)}")
							for email in new_profiles:
								print(f"🎯 Tab {tab_index}: EMAIL EXTRACTED: {email}")
								# Save via LinkedInSearchPage helper for DB logic
								LinkedInSearchPage(page).save_profile_to_mongodb(email)
							# Reset no-data counter when new found
							s["no_data_count"] = 0
						else:
							s["no_data_count"] += 1
							if s["no_data_count"] % 5 == 0:
								print(f"⏳ Tab {tab_index}: No new emails. Attempts: {s['no_data_count']}")
								# Debug: Show what we found vs what we already have
								if s["no_data_count"] % 15 == 0:  # Every 15 attempts, show debug info
									print(f"🔍 Tab {tab_index}: DEBUG - Found {len(current_profiles)} total emails, {len(profiles)} already collected")
									if current_profiles:
										print(f"🔍 Tab {tab_index}: Current emails on page: {current_profiles[:3]}...")  # Show first 3
									else:
										print(f"🔍 Tab {tab_index}: No emails found on current page view")
						
						# Stop conditions
						if len(profiles) >= MAX_POSTS:
							s["done"] = True
							results[link] = list(profiles)
							active -= 1
							print(f"✅ Tab {tab_index}: Reached target {MAX_POSTS}. Done.")
							continue
						
						# Enhanced scroll behavior
						prev_h = s["previous_height"]
						cur_h = page.evaluate("document.body.scrollHeight")
						if prev_h == cur_h:
							s["scroll_attempts"] += 1
							if s["scroll_attempts"] % 20 == 0:
								print(f"🔍 Tab {tab_index}: Same height. Attempts {s['scroll_attempts']}/{MAX_SCROLL_ATTEMPTS}")
							
							# More aggressive scrolling strategies when stuck
							if s["scroll_attempts"] % 15 == 0:  # More frequent aggressive scrolling
								# Try different scroll strategies
								strategies = [
									"window.scrollTo(0, document.body.scrollHeight)",  # Jump to bottom
									"window.scrollTo(0, document.body.scrollHeight/2)",  # Jump to middle
									"window.scrollTo(0, 0)",  # Jump to top
									"window.scrollBy(0, 2000)",  # Large scroll down
									"window.scrollBy(0, -1000)"  # Scroll up
								]
								strategy = random.choice(strategies)
								page.evaluate(strategy)
								time.sleep(random.uniform(0.8, 1.5))
								
							# Try to trigger lazy loading
							if s["scroll_attempts"] % 25 == 0:
								page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
								time.sleep(random.uniform(1.0, 2.0))
								page.evaluate("window.scrollTo(0, document.body.scrollHeight/2)")
								time.sleep(random.uniform(0.5, 1.0))
						else:
							s["scroll_attempts"] = 0
							s["previous_height"] = cur_h
						
						# Perform a variable scroll step based on attempts
						scroll_amount = 800 if s["scroll_attempts"] < 50 else 1200  # Larger scrolls when stuck
						page.evaluate(f"window.scrollBy(0, {scroll_amount})")
						# Variable pause based on how stuck we are, with additional content load wait
						base_pause = random.uniform(0.15, 0.3) if s["scroll_attempts"] < 30 else random.uniform(0.5, 1.0)
						content_wait = CONTENT_LOAD_WAIT_TIME if s["no_data_count"] > 20 else 0.5  # Longer wait when struggling to find content
						time.sleep(base_pause + content_wait)
						
						# Safety: too many attempts
						if s["scroll_attempts"] > MAX_SCROLL_ATTEMPTS or s["no_data_count"] > NO_DATA_THRESHOLD_ATTEMPTS:
							s["done"] = True
							results[link] = list(profiles)
							active -= 1
							print(f"⚠️ Tab {tab_index}: Stopping due to low activity. Total: {len(profiles)}")
					except Exception as e:
						print(f"❌ Tab {tab_index}: Error during round-robin step: {e}")
						s["done"] = True
						results[link] = list(profiles)
						active -= 1
			
		finally:
			if keep_tabs_open:
				print("🟢 keep_tabs_open=True -> Leaving tabs and context open for inspection.")
			else:
				print("🧹 Cleaning up tabs...")
				for page, _, _ in pages:
					try:
						page.close()
					except Exception as e:
						print(f"⚠️ Warning: Error closing tab: {e}")
				try:
					context.close()
				except Exception as e:
					print(f"⚠️ Warning: Error closing main context: {e}")
		
		print(f"\n🎉 All tabs processed with concurrent scrolling! Total results: {sum(len(v) for v in results.values())} emails")
		return results

	def scrape(self, keyword):
		"""
		Legacy method for backward compatibility - now redirects to scrape_multiple_links
		"""
		search_url = f"https://www.linkedin.com/search/results/content/?keywords={keyword.replace(' ', '%20')}&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22"
		return self.scrape_multiple_links([search_url])

	def _ensure_valid_context(self):
		"""
		Ensure we have a valid LinkedIn context (login session)
		"""
		# Check if the context file exists and is recent (less than 24 hours old)
		context_exists = os.path.exists(self.context_path)
		context_is_recent = False
		
		if context_exists:
			import time
			context_age = time.time() - os.path.getmtime(self.context_path)
			context_is_recent = context_age < 86400  # 24 hours in seconds
			
		if context_exists and context_is_recent:
			print(f"Loading saved context from {self.context_path} (age: {context_age/3600:.1f} hours)")
			try:
				context = load_context(self.browser, self.context_path)
				# Test if the context is still valid by trying to access LinkedIn
				page = context.new_page()
				page.goto("https://www.linkedin.com/feed/", timeout=10000)
				page.wait_for_timeout(2000)
				current_url = page.url
				page.close()
				
				if "login" not in current_url and "checkpoint" not in current_url:
					print("Saved session is still valid!")
					return context
				else:
					print("Saved session expired, need to login again")
					context_exists = False
			except Exception as e:
				print(f"Error loading saved context: {e}")
				context_exists = False
		
		if not context_exists or not context_is_recent:
			print("No valid saved context found. Logging in...")
			# Human-like delay before starting login process
			self.human_delay(2, 4)
			# Create context with anti-detection measures
			context = self.browser.new_context(
				user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				viewport={'width': 1920, 'height': 1080},
				locale='en-US',
				timezone_id='America/New_York'
			)
			page = context.new_page()
			# Stealth
			page.add_init_script("""
				Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
				Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
				Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
			""")
			login_page = LinkedInLoginPage(page)
			login_page.load()
			self.human_delay(3, 6)
			login_page.login(LINKEDIN_EMAIL, LINKEDIN_PASSWORD)
			self.human_delay(2, 4)
			# Save the context for future use
			save_context(page, self.context_path)
			print("Login successful! Session saved for future use.")
			page.close()
			return context
		
		return None
