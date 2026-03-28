import os
import playwright.sync_api as p
from playwright.sync_api import sync_playwright
from scraper import LinkedInScraper
import csv
from datetime import datetime
from config.linkedin_links import LINKEDIN_LINKS
from config.settings import MAX_PARALLEL_WORKERS

def save_to_csv(data, filename_prefix="extraction"):
	"""
	Save the extracted data to a CSV file.

	:param data: Dictionary with link as key and list of emails as value.
	:param filename_prefix: Prefix for the filename.
	"""
	# Generate a unique filename using the current timestamp
	timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
	filename = f"{filename_prefix}_{timestamp}.csv"

	# Save data to CSV
	with open(filename, mode='w', newline='', encoding='utf-8') as file:
		writer = csv.writer(file)
		writer.writerow(["Link", "Email"])  # Header
		
		# Write each email with its corresponding link
		for link, emails in data.items():
			for email in emails:
				writer.writerow([link, email])

	print(f"Emails saved to {filename}")
	return filename

def main():
	"""Main function to run the LinkedIn scraper"""
	print("🔍 Starting LinkedIn Scraper...")
	
	# Read headless mode from environment (default: True for cloud/automated runs)
	headless_mode = os.environ.get('HEADLESS_MODE', 'true').lower() == 'true'
	print(f"Running in {'headless' if headless_mode else 'headed'} mode")

	# Only keep browser open in headed/local mode for inspection
	keep_open = not headless_mode
	
	# Use LinkedIn links from configuration file
	linkedin_links = LINKEDIN_LINKS
	
	print(f"📋 Will scrape {len(linkedin_links)} LinkedIn links:")
	for i, link in enumerate(linkedin_links, 1):
		print(f"  {i}. {link}")
	
	# Configure processing using settings
	max_workers = MAX_PARALLEL_WORKERS
	print(f"\n⚡ TRUE PARALLEL Processing Configuration:")
	print(f"   - Maximum parallel workers: {max_workers}")
	print(f"   - Links will be processed SIMULTANEOUSLY in parallel threads")
	print(f"   - Each link gets its own browser context for maximum speed")
	print(f"   - Optimized for speed and parallel execution")
	
	if len(linkedin_links) > max_workers:
		print(f"   - Links will be processed in parallel batches of {max_workers}")
	else:
		print(f"   - All links will be processed SIMULTANEOUSLY in parallel")
	
	try:
		with sync_playwright() as p:
			# Launch browser with anti-detection measures and GUI visible
			browser = p.chromium.launch(
				headless=headless_mode,
				args=[
					'--disable-blink-features=AutomationControlled',
					'--disable-dev-shm-usage',
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-web-security',
					'--disable-features=VizDisplayCompositor',
					'--disable-gpu',
					'--disable-software-rasterizer',
					'--disable-extensions',
					'--disable-plugins',
					'--disable-background-timer-throttling',
					'--disable-backgrounding-occluded-windows',
					'--disable-renderer-backgrounding',
					'--disable-field-trial-config',
					'--disable-ipc-flooding-protection'
				]
			)
			
			print("🌐 Browser launched successfully")
			print("💡 Browser GUI should now be visible - you can watch the TRUE PARALLEL scraping process!")
			print("🔗 Multiple browser contexts will be created for TRUE parallel processing")
			
			scraper = LinkedInScraper(browser)
			
			print(f"\n🚀 Starting TRUE PARALLEL scraping of {len(linkedin_links)} LinkedIn links...")
			print("⏱️  Estimated time: This will be MUCH faster with true parallel processing!")
			
			# Use the TRUE parallel multiple links functionality
			results = scraper.scrape_multiple_links(linkedin_links, max_workers=max_workers, keep_tabs_open=keep_open)
			
			if results:
				total_profiles = sum(len(profiles) for profiles in results.values())
				print(f"\n✅ TRUE PARALLEL scraping completed! Found {total_profiles} total profiles across all links")
				
				# Print summary for each link
				print("\n📊 Results Summary:")
				for link, profiles in results.items():
					# Extract keywords from URL for better display
					try:
						if 'keywords=' in link:
							keywords = link.split('keywords=')[1].split('&')[0].replace('%20', ' ')
						else:
							keywords = 'Unknown'
					except:
						keywords = 'Unknown'
					print(f"   🔗 {keywords}: {len(profiles)} profiles")
				
				# Save to CSV
				filename = save_to_csv(results, "linkedin_extraction")
				print(f"\n💾 All data saved to {filename}")
				
				print("\n🎉 TRUE PARALLEL scraping process completed successfully!")
				print(f"⚡ Processed {len(linkedin_links)} links SIMULTANEOUSLY using {max_workers} parallel workers")
			else:
				print("❌ No results obtained from any links")
			
			if keep_open:
				print("\n🟢 Keeping the browser open for inspection. Press Enter here to close.")
				try:
					input()
				except KeyboardInterrupt:
					pass
			
	except Exception as e:
		print(f"❌ Error during scraping: {e}")
		import traceback
		traceback.print_exc()
		raise

if __name__ == "__main__":
	main()
