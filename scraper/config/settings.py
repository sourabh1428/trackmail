CONTEXT_FILE = "linkedin_context.json"
MAX_POSTS = 200

# Parallel processing settings
MAX_PARALLEL_WORKERS = 3  # Maximum number of parallel threads for scraping multiple links
# Note: Keep this low (2-4) to avoid overwhelming LinkedIn and triggering rate limits

# Human-like behavior settings
MIN_DELAY = 1.0  # Minimum delay in seconds
MAX_DELAY = 3.0  # Maximum delay in seconds
TYPING_MIN_DELAY = 0.05  # Minimum delay between keystrokes
TYPING_MAX_DELAY = 0.15  # Maximum delay between keystrokes
SCROLL_MIN_DELAY = 0.3   # Minimum delay after scrolling
SCROLL_MAX_DELAY = 1.5   # Maximum delay after scrolling

# Security challenge settings
SECURITY_CHALLENGE_WAIT = 30  # Seconds to wait for manual challenge resolution

# Enhanced scrolling settings
NO_DATA_THRESHOLD = 3.0  # Seconds without data before enhanced scrolling
MAX_NO_DATA_ATTEMPTS = 20  # Maximum consecutive attempts without data
SCROLL_UP_DOWN_FREQUENCY = 3  # Every Nth attempt, scroll up and down
SCROLL_DIRECTION_CHANGE_CHANCE = 0.3  # 30% chance to change scroll direction
SCROLL_BOTTOM_BACK_FREQUENCY = 5  # Every Nth attempt, scroll to bottom and back

# Round-robin parallel scroller stop conditions (for scrape_multiple_links)
# Increase these if tabs stop due to "low activity" too soon
ROUND_ROBIN_MAX_SCROLL_ATTEMPTS = 1000  # Increased from 600 to 1000 for much longer runs
ROUND_ROBIN_NO_DATA_THRESHOLD_ATTEMPTS = 100  # Increased from 40 to 100 to be more persistent

# Additional wait time between scroll attempts to allow content to load
CONTENT_LOAD_WAIT_TIME = 2.0  # Seconds to wait for content to load after scrolling