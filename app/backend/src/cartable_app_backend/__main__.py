"""PyInstaller entry point — bundled binary lands here.

Absolute import: PyInstaller's --onefile invokes this script directly without
package context, so `from .server import ...` would fail with ImportError.
"""

from cartable_app_backend.server import main

if __name__ == "__main__":
    main()
