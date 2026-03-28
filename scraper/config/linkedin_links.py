# LinkedIn Links Configuration
# Add your LinkedIn search URLs here to scrape multiple pages

LINKEDIN_LINKS = [
    # Example links - modify these with your own LinkedIn search URLs
    
    # Software Engineering roles
    "https://www.linkedin.com/search/results/content/?keywords=hiring%20software%20engineer&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22",
    "https://www.linkedin.com/search/results/content/?keywords=reactjs%20hiring&origin=SWITCH_SEARCH_VERTICAL&sid=5Lz"
]

# How to add your own links:
# 1. Go to LinkedIn and perform a search
# 2. Copy the URL from your browser's address bar
# 3. Add it to the LINKEDIN_LINKS list above
# 4. Make sure to URL-encode spaces and special characters
# 5. The scraper will process each link in a new tab

# Example of adding a custom search:
# "https://www.linkedin.com/search/results/content/?keywords=your%20custom%20search&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22",

# Tips for effective LinkedIn searches:
# - Use specific job titles: "senior software engineer" instead of just "engineer"
# - Add location: "hiring software engineer san francisco"
# - Use industry-specific terms: "hiring blockchain developer"
# - Include company size: "hiring startup software engineer"
# - Use recent filters: sortBy=%22date_posted%22 ensures recent posts
