import csv
import os
import random
import time
from datetime import datetime
import threading
from pymongo import MongoClient
from .base_page import BasePage
from config.settings import (
    NO_DATA_THRESHOLD, MAX_NO_DATA_ATTEMPTS, SCROLL_UP_DOWN_FREQUENCY,
    SCROLL_DIRECTION_CHANGE_CHANCE, SCROLL_BOTTOM_BACK_FREQUENCY
)

class LinkedInSearchPage(BasePage):
    def __init__(self, page, mongo_client=None):
        super().__init__(page)
        self.bunch_id = datetime.now().strftime("%d%m%y")

        if mongo_client is not None:
            # Use the shared client passed in — do NOT create a new one
            self.client = None  # not owned by this instance
            _client = mongo_client
        else:
            # Fallback: create own client (for standalone use only)
            mongodb_uri = os.getenv('MONGODB_URI')
            if not mongodb_uri:
                print("⚠️ Warning: MONGODB_URI not set.")
            try:
                self.client = MongoClient(mongodb_uri)
                self.client.admin.command('ping')
                print("✅ MongoDB connection successful (standalone)")
                _client = self.client
            except Exception as e:
                print(f"❌ MongoDB connection failed: {e}")
                self.client = None
                self.collection = None
                print(f"Generated bunch ID: {self.bunch_id}")
                return

        db_name = os.getenv('MONGODB_DATABASE', 'Linkedin_scrape')
        collection_name = os.getenv('MONGODB_COLLECTION', 'Emails')
        self.db = _client[db_name]
        self.collection = self.db[collection_name]
        print(f"Generated bunch ID: {self.bunch_id}")

    def get_initials(self, email):
        """
        Extract initials from email address as first name
        Example: john.doe@example.com -> J.D.
        """
        try:
            # Get the local part of the email (before @)
            local_part = email.split('@')[0]
            # Split by common separators
            parts = local_part.replace('.', ' ').replace('-', ' ').replace('_', ' ').split()
            # Get initials
            initials = '.'.join(word[0].upper() for word in parts if word) + '.'
            return initials
        except:
            return 'Unknown'

    def search_keyword(self, keyword):
        """
        Perform a LinkedIn search using the provided keyword.
        """
        search_url = f"https://www.linkedin.com/search/results/content/?keywords=hiring%20software%20engineer&origin=GLOBAL_SEARCH_HEADER&sid=C6X&sortBy=%22date_posted%22"
        print(f"Navigating to: {search_url}")
        
        # Human-like delay before navigation
        self.human_delay(2, 4)
        
        self.page.goto(search_url)
        
        # Wait for page to load with a shorter timeout
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=15000)
            print("Page DOM loaded")
        except Exception as e:
            print(f"DOM load timeout: {e}")
        
        # Human-like delay after page loads
        self.human_delay(2, 4)
        
        # Random scroll to simulate human behavior
        self.random_scroll()
        
        # Wait a bit for dynamic content
        self.page.wait_for_timeout(3000)
        
        # Check if we're on a checkpoint page
        current_url = self.page.url
        if "checkpoint" in current_url or "challenge" in current_url:
            print(f"WARNING: Redirected to LinkedIn checkpoint: {current_url}")
            print("This usually means LinkedIn detected automated behavior.")
            print("You may need to:")
            print("1. Complete the security challenge manually in the browser")
            print("2. Use a different approach or wait before retrying")
            print("3. Consider using a different scraping method")
            
            # Take a screenshot for debugging
            self.page.screenshot(path="debug_checkpoint_page.png")
            print("Screenshot saved as debug_checkpoint_page.png")
            return False
        
        # Human-like delay before taking screenshot
        self.human_delay(1, 2)
        
        # Take a screenshot for debugging
        self.page.screenshot(path="debug_search_page.png")
        print("Screenshot saved as debug_search_page.png")
        
        # Try to find the search results container with a longer timeout
        try:
            self.page.wait_for_selector("div.search-results-container", timeout=30000)
            print("Found search-results-container")
            
            # Human-like delay after finding results
            self.human_delay(1, 3)
            
            return True
        except Exception as e:
            print(f"Could not find search-results-container: {e}")
            # Try alternative selectors
            try:
                self.page.wait_for_selector("div[data-test-id='search-results']", timeout=10000)
                print("Found alternative selector: div[data-test-id='search-results']")
                
                # Human-like delay after finding alternative results
                self.human_delay(1, 2)
                
                return True
            except Exception as e2:
                print(f"Could not find alternative selector either: {e2}")
                # Try more generic selectors
                try:
                    self.page.wait_for_selector("main", timeout=10000)
                    print("Found main element")
                except Exception as e3:
                    print(f"Could not find main element: {e3}")
                
                # List all div elements to see what's available
                divs = self.page.locator("div").all()
                print(f"Found {len(divs)} div elements on the page")
                for i, div in enumerate(divs[:10]):  # Show first 10 divs
                    try:
                        class_name = div.get_attribute("class")
                        print(f"Div {i}: class='{class_name}'")
                    except:
                        pass
                return False

    def smart_scroll_with_monitoring(self, profiles, max_posts, max_scroll_attempts=100):
        """
        Smart scrolling with data ingestion monitoring and enhanced scroll behavior
        """
        scroll_count = 0
        no_data_count = 0
        previous_height = None
        last_data_time = time.time()
        scroll_direction = 1  # 1 for down, -1 for up
        
        print(f"Starting smart scrolling with bunch ID: {self.bunch_id}")
        print(f"Target profiles: {max_posts}")
        print(f"Enhanced scrolling threshold: {NO_DATA_THRESHOLD}s")
        
        while len(profiles) < max_posts and scroll_count < max_scroll_attempts:
            # Wait for content to load
            self.human_delay(1, 2)
            
            # Get current profiles
            current_profiles = self.page.locator("a[href^='mailto:']").evaluate_all(
                "elements => elements.map(e => e.href.replace('mailto:', '').trim())"
            )
            
            # Check for new profiles
            new_profiles = set(current_profiles) - profiles
            if new_profiles:
                profiles.update(new_profiles)
                last_data_time = time.time()
                no_data_count = 0
                print(f"✅ Found {len(new_profiles)} new profiles. Total: {len(profiles)}")
                
                # Process new profiles (save to MongoDB and CSV)
                for email in new_profiles:
                    print(f"🎯 EMAIL EXTRACTED: {email}")
                    self.save_profile_to_mongodb(email)
            else:
                no_data_count += 1
                current_time = time.time()
                time_since_last_data = current_time - last_data_time
                
                # Make this log less prominent
                if no_data_count % 5 == 0:  # Only show every 5th attempt
                    print(f"⏳ No new profiles found. Count: {no_data_count}, Time since last data: {time_since_last_data:.1f}s")
                
                # If no data for threshold seconds, try enhanced scrolling
                if time_since_last_data > NO_DATA_THRESHOLD:
                    # Make scrolling logs less prominent
                    if no_data_count % 3 == 0:  # Only show every 3rd attempt
                        print(f"🔄 No data ingested for {NO_DATA_THRESHOLD}+ seconds. Trying enhanced scrolling...")
                    
                    # Enhanced scrolling strategy
                    if no_data_count % SCROLL_UP_DOWN_FREQUENCY == 0:  # Every Nth attempt
                        # Scroll up and down to trigger content loading
                        # Make scrolling logs less prominent
                        if no_data_count % 6 == 0:  # Only show every 6th attempt
                            print("📜 Scrolling up and down to trigger content...")
                        self.page.evaluate("window.scrollTo(0, 0)")
                        self.human_delay(1, 2)
                        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        self.human_delay(1, 2)
                        
                        # Random scroll in middle area
                        middle_height = self.page.evaluate("document.body.scrollHeight / 2")
                        random_offset = random.randint(-200, 200)
                        self.page.evaluate(f"window.scrollTo(0, {middle_height + random_offset})")
                        self.human_delay(1, 2)
                        
                        scroll_direction = 1  # Reset direction
                    else:
                        # Normal scrolling with direction change
                        if scroll_direction == 1:
                            # Scroll down
                            self.page.evaluate("window.scrollBy(0, 800)")
                        else:
                            # Scroll up a bit
                            self.page.evaluate("window.scrollBy(0, -400)")
                            scroll_direction = 1
                        
                        # Change direction occasionally
                        if random.random() < SCROLL_DIRECTION_CHANGE_CHANCE:
                            scroll_direction *= -1
                    
                    # Wait longer for content to load
                    self.human_delay(2, 4)
            
            # Check if we've reached the bottom
            current_height = self.page.evaluate("document.body.scrollHeight")
            if previous_height == current_height:
                scroll_count += 1
                # Make this log less prominent
                if scroll_count % 20 == 0:  # Only show every 20th attempt
                    print(f"🔍 Same page height detected. Attempt {scroll_count}/{max_scroll_attempts}")
                
                # Try to scroll to bottom and back up
                if scroll_count % SCROLL_BOTTOM_BACK_FREQUENCY == 0:  # Every Nth attempt
                    # Make this log less prominent
                    if scroll_count % 30 == 0:  # Only show every 30th attempt
                        print("🔄 Attempting to scroll to bottom and back up...")
                    self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    self.human_delay(2, 3)
                    self.page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                    self.human_delay(2, 3)
            else:
                scroll_count = 0
                previous_height = current_height
            
            # Progress update - make this more prominent
            if scroll_count % 5 == 0:  # Show more frequently
                print(f"📊 Progress: {len(profiles)}/{max_posts} profiles, {scroll_count} scroll attempts")
            
            # Safety check - if no data for too long, break
            if no_data_count > MAX_NO_DATA_ATTEMPTS:
                print(f"⚠️ No new data for {MAX_NO_DATA_ATTEMPTS} consecutive attempts. Stopping...")
                break
        
        return profiles

    def save_profile_to_mongodb(self, email):
        """
        Save a profile to MongoDB
        """
        if self.collection is None:
            return
        
        try:
            # Create document
            document = {
                "email": email,
                "name": self.get_initials(email),
                "bunch_id": self.bunch_id,
                "timestamp": datetime.now(),
                "source": "linkedin_scraper"
            }
            
            # Insert into MongoDB
            result = self.collection.insert_one(document)
            print(f"💾 SAVED TO DATABASE: {email}")
            
        except Exception as e:
            print(f"❌ Failed to save to MongoDB: {email} - {e}")

    def scrape_user_profiles(self, max_posts=500, output_file="profiles.csv"):
        """
        Scrape user profiles with enhanced scrolling and monitoring.
        """
        profiles = set()
        
        # Open CSV file for backup
        with open(output_file, mode="a", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            file.seek(0, 2)
            if file.tell() == 0:
                writer.writerow(["Email", "Name", "Bunch ID"])
            
            # Use enhanced scrolling
            profiles = self.smart_scroll_with_monitoring(profiles, max_posts)
            
            # Final save to CSV
            print(f"\n💾 Saving {len(profiles)} profiles to CSV...")
            for email in profiles:
                writer.writerow([email, self.get_initials(email), self.bunch_id])
                file.flush()
                os.fsync(file.fileno())
        
        print(f"✅ Scraping completed! Total profiles: {len(profiles)}")
        print(f"📁 Data saved with bunch ID: {self.bunch_id}")
        return list(profiles)

    def __del__(self):
        """Cleanup MongoDB connection only if we own it"""
        if hasattr(self, 'client') and self.client:
            try:
                self.client.close()
            except:
                pass