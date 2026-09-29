"""
Phase 34.5: the app's version (Semantic Versioning, 0.<phase>.<sub-phase>).

Keep this equal to "version" in frontend/package.json. Both are bumped together at the end of every phase
(see CHANGELOG.md). The admin System tab shows both and warns when they differ, which usually means one
container is still running an old build.
"""
APP_VERSION = "0.35.0"
