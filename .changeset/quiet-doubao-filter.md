---
"@workspace/web": patch
---

Keep baseline model filters tied to the model each run actually executed, treat the legacy generic doubao filter as the same family, and show honest states for other versions or missing model identity. Sidebar navigation between the five baseline dashboards now preserves the explicit model, lookback, tags and query filters instead of silently dropping them.