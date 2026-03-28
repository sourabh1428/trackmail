#!/usr/bin/env python3
"""
Helper script to add LinkedIn links to the configuration file.
This script makes it easy to add new LinkedIn search URLs without editing the config file directly.
"""

import os
import re
from urllib.parse import quote

def validate_linkedin_url(url):
    """Validate if the URL is a valid LinkedIn search URL"""
    linkedin_pattern = r'^https?://(?:www\.)?linkedin\.com/search/results/.*'
    return bool(re.match(linkedin_pattern, url))

def add_linkedin_link():
    """Interactive function to add a new LinkedIn link"""
    print("🔗 LinkedIn Link Adder")
    print("=" * 50)
    
    print("\nTo add a new LinkedIn link:")
    print("1. Go to LinkedIn and perform a search")
    print("2. Copy the URL from your browser's address bar")
    print("3. Paste it below")
    print("\nExample URL format:")
    print("https://www.linkedin.com/search/results/content/?keywords=hiring%20software%20engineer&origin=GLOBAL_SEARCH_HEADER&sortBy=%22date_posted%22")
    
    while True:
        print("\n" + "-" * 50)
        url = input("Enter LinkedIn URL (or 'quit' to exit): ").strip()
        
        if url.lower() == 'quit':
            print("Exiting...")
            return
        
        if not url:
            print("❌ URL cannot be empty. Please try again.")
            continue
        
        if not validate_linkedin_url(url):
            print("❌ Invalid LinkedIn URL. Please make sure it's a LinkedIn search URL.")
            continue
        
        # Ask for a description
        description = input("Enter a description for this link (e.g., 'Software Engineer jobs'): ").strip()
        
        # Confirm
        print(f"\n📋 Link: {url}")
        print(f"📝 Description: {description}")
        confirm = input("\nAdd this link? (y/n): ").strip().lower()
        
        if confirm in ['y', 'yes']:
            add_link_to_config(url, description)
            break
        else:
            print("Link not added. Try again or type 'quit' to exit.")

def add_link_to_config(url, description):
    """Add the link to the configuration file"""
    config_file = "config/linkedin_links.py"
    
    try:
        # Read the current config file
        with open(config_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find the end of the LINKEDIN_LINKS list
        lines = content.split('\n')
        insert_index = None
        
        for i, line in enumerate(lines):
            if line.strip() == ']':
                insert_index = i
                break
        
        if insert_index is None:
            print("❌ Could not find the end of LINKEDIN_LINKS list in config file")
            return
        
        # Create the new link entry
        new_link = f'    "{url}",  # {description}'
        
        # Insert the new link before the closing bracket
        lines.insert(insert_index, new_link)
        
        # Write back to file
        with open(config_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        
        print(f"✅ Successfully added link to {config_file}")
        print(f"🔗 New link: {url}")
        print(f"📝 Description: {description}")
        
    except Exception as e:
        print(f"❌ Error adding link to config file: {e}")

def show_current_links():
    """Display all currently configured LinkedIn links"""
    try:
        from config.linkedin_links import LINKEDIN_LINKS
        
        print("📋 Current LinkedIn Links:")
        print("=" * 50)
        
        if not LINKEDIN_LINKS:
            print("No links configured yet.")
            return
        
        for i, link in enumerate(LINKEDIN_LINKS, 1):
            print(f"{i}. {link}")
        
        print(f"\nTotal: {len(LINKEDIN_LINKS)} links")
        
    except ImportError:
        print("❌ Could not import LinkedIn links configuration")
    except Exception as e:
        print(f"❌ Error showing current links: {e}")

def main():
    """Main function"""
    print("🔗 LinkedIn Link Manager")
    print("=" * 50)
    
    while True:
        print("\nOptions:")
        print("1. Show current links")
        print("2. Add new link")
        print("3. Exit")
        
        choice = input("\nChoose an option (1-3): ").strip()
        
        if choice == '1':
            show_current_links()
        elif choice == '2':
            add_linkedin_link()
        elif choice == '3':
            print("👋 Goodbye!")
            break
        else:
            print("❌ Invalid choice. Please enter 1, 2, or 3.")

if __name__ == "__main__":
    main()
