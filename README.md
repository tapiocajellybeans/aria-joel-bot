# ARIA — Telegram Bot Setup Guide (v3)
Powered by **StepFun Free (step-3.5-flash free)** + **SQLite** persistent storage.

---

## New Features & Updates
* **Enhanced Task Management**: Now supports adding and removing multiple tasks simultaneously using optimized JSON processing.
* **Facts Table (Brain Storage)**: A dedicated persistent storage for long-term facts.ARIA can now dynamically identify and store important information to its "brain" during conversations.
* **Multi-Format Document Scraping**: ARIA can now read, scrape, and store data from `docx`, `xlsx`, `pdf`, `csv`, and plaintext files.
* **Dynamic Reasoning Engine**: Integrated a reasoning system that adjusts its processing depth based on the task:
    * **High**: Complex documents.
    * **Medium**: Long text analysis.
    * **Low**: Simple/easy tasks.

---
## **Bot commands:**
```
start - Start ARIA
help - Show available commands
clear - Wipe conversation memory
tasks - List pending tasks
brief - Get a daily briefing
addtask - add tasks
gettask - get tasks
```
---

## Commands & Capabilities

| Feature | Description |
| :--- | :--- |
| **Natural Language Tasks** |Add/remove single or multiple tasks at once. |
| **Document Reading** |Upload `pdf`, `xlsx`, `docx`, or `csv` for ARIA to analyze. |
| **Brain Storage** |Manual or AI-driven updates to a persistent facts table. |
| **Memory Management** | `/clear` wipes chat history while keeping tasks and facts safe. |

---

## Persistent Storage
* **aria.db**: This SQLite file stores all conversation history, pending tasks, and the new **Facts Table**.
* **Reasoning Logs**: View internal logic processing within the system logs to see how ARIA evaluates different task types.

---

## Future Roadmap
* **Agentic Tasks**: Exporting DB to Google Sheets for automated polling and task reminders via Apps Script.
* **External Integrations**: Adding access to third-party services like Gmail.
* **Dynamic Fact Editing**: Allowing users to edit or remove "brain" facts directly from the system prompt.
* **Cloud Hosting**: Moving to a VPS for 24/7 uptime.