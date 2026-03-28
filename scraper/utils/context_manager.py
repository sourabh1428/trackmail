import os

def save_context(page, path):
    """Save the browser context to a file."""
    page.context.storage_state(path=path)
    print(f"Saved browser context to {path}")

def load_context(browser, path):
    """Load browser context from file or create a new one."""
    if os.path.exists(path):
        return browser.new_context(storage_state=path)
    else:
        print(f"Context file not found: {path}. Creating a new context.")
        return browser.new_context()
