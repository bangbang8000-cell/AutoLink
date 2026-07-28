"""
Backend tests configuration
"""
import sys
import os

# Add backend directory to path (relative to this conftest.py)
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)