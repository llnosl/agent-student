#!/usr/bin/env python3
"""Crawl Kibana Discover error rows and save them as a monthly JSON report."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright


DEFAULT_COLUMNS = [
    "Time",
    "context.release",
    "context.exception.exception_type_1",
    "context.exception.exception_type_2",
    "context.exception.exception_type_3",
    "context.request.url",
    "context.user.name",
]

COLUMN_ALIASES = {
    "context.request.url": ["ui.page"],
    "ui.page": ["context.request.url"],
}


def log(message: str) -> None:
    print(message, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crawl Kibana Discover table rows and write a monthly stability error JSON file."
    )
    parser.add_argument("url", help="Kibana Discover URL to crawl.")
    parser.add_argument("--project", required=True, help="Project name used in the output file name.")
    parser.add_argument("--output-dir", default=".", help="Directory for the generated JSON file.")
    parser.add_argument("--storage-state", help="Playwright storage state JSON for logged-in sessions.")
    parser.add_argument("--save-storage-state", help="Save login state after the page is loaded.")
    parser.add_argument(
        "--cdp-url",
        help="Connect to an existing Chrome started with --remote-debugging-port, for example http://127.0.0.1:9222.",
    )
    parser.add_argument(
        "--existing-chrome",
        action="store_true",
        help="Auto-detect and connect to an already running Chrome with remote debugging enabled.",
    )
    parser.add_argument(
        "--check-connection-only",
        action="store_true",
        help="Only check whether the script can connect to Chrome, then exit without crawling.",
    )
    parser.add_argument("--login-username", help="Username for automatic login when a login page is detected.")
    parser.add_argument(
        "--login-password-env",
        default="KIBANA_PASSWORD",
        help="Environment variable name that stores the login password.",
    )
    parser.add_argument("--headed", action="store_true", help="Show browser window, useful for manual login.")
    parser.add_argument("--timeout", type=int, default=120_000, help="Page/table wait timeout in milliseconds.")
    parser.add_argument(
        "--columns",
        nargs="*",
        default=DEFAULT_COLUMNS,
        help="Columns to extract from the Discover table.",
    )
    return parser.parse_args()


def safe_filename_part(value: str) -> str:
    value = value.strip() or "unknown-project"
    return re.sub(r"[\\/:*?\"<>|\s]+", "-", value).strip("-")


def output_path(output_dir: str, project: str) -> Path:
    month = datetime.now().strftime("%Y-%m")
    filename = f"{month}-{safe_filename_part(project)}-稳定性错误.json"
    return Path(output_dir).expanduser().resolve() / filename


def find_existing_chrome_cdp_url() -> str | None:
    for port in range(9222, 9233):
        url = f"http://127.0.0.1:{port}"
        try:
            with urllib.request.urlopen(f"{url}/json/version", timeout=1) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            continue

        browser = payload.get("Browser", "")
        if "Chrome" in browser or "Chromium" in browser:
            return url
    return None


async def has_no_discover_results(page: Any) -> bool:
    no_result_markers = [
        "[data-test-subj='discoverNoResults']",
        "text='No results match your search criteria'",
        "text='0 hits'",
    ]
    for selector in no_result_markers:
        locator = page.locator(selector).first
        try:
            if await locator.is_visible():
                return True
        except Exception:
            continue
    return False


async def wait_for_discover_table(page: Any, timeout: int) -> bool:
    log("Waiting for Kibana page DOM...")
    await page.wait_for_load_state("domcontentloaded", timeout=timeout)
    try:
        log("Waiting for Kibana network to become idle...")
        await page.wait_for_load_state("networkidle", timeout=30_000)
    except PlaywrightTimeoutError:
        log("Network did not become idle within 30s; continuing to table detection.")

    if await has_no_discover_results(page):
        log("Kibana Discover returned 0 hits.")
        return False

    selectors = [
        "table:has-text('context.exception')",
        "[data-test-subj='docTable']",
        ".kbnDocTable",
        ".discover-table",
        "[role='grid']",
        "table",
    ]
    selector_timeout = min(timeout, 10_000)
    for selector in selectors:
        try:
            log(f"Looking for Discover table with selector: {selector}")
            await page.locator(selector).first.wait_for(state="visible", timeout=selector_timeout)
            return True
        except PlaywrightTimeoutError:
            if await has_no_discover_results(page):
                log("Kibana Discover returned 0 hits.")
                return False
            continue
    title = await page.title()
    raise RuntimeError(
        "Kibana Discover table was not found. "
        f"Current page title: {title!r}. "
        "Check login state, URL, or page layout. Try --headed if login is required."
    )


async def login_if_needed(page: Any, args: argparse.Namespace) -> None:
    password_input = page.locator("input[type='password']").first
    try:
        await password_input.wait_for(state="visible", timeout=5_000)
    except PlaywrightTimeoutError:
        log("No login form detected; continuing.")
        return

    if not args.login_username:
        raise RuntimeError("Login page detected, but --login-username was not provided.")

    password = os.environ.get(args.login_password_env)
    if not password:
        raise RuntimeError(
            "Login page detected, but password environment variable "
            f"{args.login_password_env!r} is empty or not set."
        )

    log("Login form detected; submitting credentials...")
    username_selectors = [
        "input[type='text']",
        "input[type='email']",
        "input[name*='user' i]",
        "input[id*='user' i]",
        "input[name*='account' i]",
        "input[id*='account' i]",
        "input:not([type])",
    ]

    username_filled = False
    for selector in username_selectors:
        field = page.locator(selector).first
        try:
            await field.wait_for(state="visible", timeout=1_000)
        except PlaywrightTimeoutError:
            continue
        await field.fill(args.login_username)
        username_filled = True
        break

    if not username_filled:
        raise RuntimeError("Login page detected, but username field was not found.")

    await password_input.fill(password)

    submit_selectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button:has-text('登录')",
        "button:has-text('Login')",
        "button:has-text('Sign in')",
    ]
    for selector in submit_selectors:
        button = page.locator(selector).first
        try:
            await button.wait_for(state="visible", timeout=1_000)
        except PlaywrightTimeoutError:
            continue
        await button.click()
        break
    else:
        await password_input.press("Enter")

    try:
        await page.wait_for_load_state("networkidle", timeout=30_000)
    except PlaywrightTimeoutError:
        pass


async def extract_visible_rows(page: Any, wanted_columns: list[str]) -> dict[str, Any]:
    return await page.evaluate(
        r"""
        ({ wantedColumns, columnAliases }) => {
          const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const tables = [...document.querySelectorAll('table')];
          const grids = [...document.querySelectorAll("[role='grid']")];
          const containers = [...tables, ...grids];
          const candidateColumns = wantedColumns.flatMap(
            (column) => [column, ...(columnAliases[column] || [])]
          );
          const dataContainer = containers.find((candidate) => {
            const text = normalize(candidate.innerText);
            return candidateColumns.some((column) => text.includes(column));
          }) || containers[0];

          if (!dataContainer) {
            return {
              rows: [],
              matchedColumns: {},
              missingColumns: [...wantedColumns],
            };
          }

          const headerCells = [
            ...dataContainer.querySelectorAll(
              "thead th, tr:first-child th, tr:first-child td, [role='columnheader']"
            ),
          ];
          const headers = headerCells.map((cell) => normalize(cell.innerText));
          const columnMatches = wantedColumns.map((column) => {
            const candidates = [column, ...(columnAliases[column] || [])];
            for (const candidate of candidates) {
              const exact = headers.findIndex((header) => header === candidate);
              if (exact >= 0) {
                return { requested: column, actual: headers[exact], index: exact };
              }
            }
            for (const candidate of candidates) {
              const partial = headers.findIndex((header) => header.includes(candidate));
              if (partial >= 0) {
                return { requested: column, actual: headers[partial], index: partial };
              }
            }
            return { requested: column, actual: '', index: -1 };
          });

          const bodyRows = [...dataContainer.querySelectorAll('tbody tr')];
          const tableRows = bodyRows.length
            ? bodyRows
            : [...dataContainer.querySelectorAll('tr')].slice(1);
          const gridRows = [...dataContainer.querySelectorAll("[role='row']")]
            .filter((row) => row.querySelector("[role='gridcell']"));
          const rows = tableRows.length ? tableRows : gridRows;

          const findScrollContainer = () => {
            let current = rows[0] || dataContainer;
            while (current && current !== document.body) {
              const style = window.getComputedStyle(current);
              const canScroll = /(auto|scroll)/.test(style.overflowY)
                && current.scrollHeight > current.clientHeight + 1;
              if (canScroll) return current;
              current = current.parentElement;
            }
            return document.scrollingElement || document.documentElement;
          };
          const scrollContainer = findScrollContainer();
          const isDocumentScroll = scrollContainer === document.scrollingElement
            || scrollContainer === document.documentElement
            || scrollContainer === document.body;
          const scrollTop = isDocumentScroll ? window.scrollY : scrollContainer.scrollTop;
          const scrollRect = isDocumentScroll
            ? { top: 0 }
            : scrollContainer.getBoundingClientRect();

          const extractedRows = rows.map((row) => {
            const cellElements = [
              ...row.querySelectorAll("td, [role='gridcell']"),
            ];
            const cells = cellElements.map((cell) => normalize(cell.innerText));
            const item = {};
            wantedColumns.forEach((column, wantedIndex) => {
              const cellIndex = columnMatches[wantedIndex].index;
              item[column] = cellIndex >= 0 ? (cells[cellIndex] || '') : '';
            });

            const identityAttributes = [
              'aria-rowindex',
              'data-row-index',
              'data-document-number',
              'data-id',
              'id',
            ];
            const identity = identityAttributes
              .map((attribute) => row.getAttribute(attribute))
              .find(Boolean);
            const rowRect = row.getBoundingClientRect();
            const absoluteTop = Math.round(
              scrollTop + rowRect.top - scrollRect.top
            );
            const contentKey = JSON.stringify(item);

            return {
              key: identity
                ? `identity:${identity}:${contentKey}`
                : `position:${absoluteTop}:${contentKey}`,
              item,
            };
          }).filter(({ item }) => Object.values(item).some(Boolean));

          return {
            rows: extractedRows,
            matchedColumns: Object.fromEntries(
              columnMatches
                .filter((match) => match.index >= 0)
                .map((match) => [match.requested, match.actual])
            ),
            missingColumns: columnMatches
              .filter((match) => match.index < 0)
              .map((match) => match.requested),
          };
        }
        """,
        {
            "wantedColumns": wanted_columns,
            "columnAliases": COLUMN_ALIASES,
        },
    )


async def get_scroll_state(page: Any, wanted_columns: list[str]) -> dict[str, Any]:
    return await page.evaluate(
        r"""
        (wantedColumns) => {
          const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const containers = [
            ...document.querySelectorAll("table, [role='grid']")
          ];
          const dataContainer = containers.find((candidate) => {
            const text = normalize(candidate.innerText);
            return wantedColumns.some((column) => text.includes(column));
          }) || containers[0];

          if (!dataContainer) {
            return {
              scrollable: false,
              top: 0,
              maxTop: 0,
              scrollHeight: 0,
              clientHeight: 0,
              atBottom: true,
            };
          }

          let scrollContainer = dataContainer.querySelector(
            "tbody tr, [role='row']"
          ) || dataContainer;
          while (scrollContainer && scrollContainer !== document.body) {
            const style = window.getComputedStyle(scrollContainer);
            const canScroll = /(auto|scroll)/.test(style.overflowY)
              && scrollContainer.scrollHeight > scrollContainer.clientHeight + 1;
            if (canScroll) break;
            scrollContainer = scrollContainer.parentElement;
          }
          if (!scrollContainer || scrollContainer === document.body) {
            scrollContainer = document.scrollingElement || document.documentElement;
          }

          const isDocumentScroll = scrollContainer === document.scrollingElement
            || scrollContainer === document.documentElement
            || scrollContainer === document.body;
          const top = isDocumentScroll ? window.scrollY : scrollContainer.scrollTop;
          const scrollHeight = scrollContainer.scrollHeight;
          const clientHeight = isDocumentScroll ? window.innerHeight : scrollContainer.clientHeight;
          const maxTop = Math.max(0, scrollHeight - clientHeight);

          return {
            scrollable: maxTop > 1,
            top,
            maxTop,
            scrollHeight,
            clientHeight,
            atBottom: maxTop - top <= 2,
          };
        }
        """,
        wanted_columns,
    )


async def scroll_discover_table(page: Any, wanted_columns: list[str]) -> None:
    await page.evaluate(
        r"""
        (wantedColumns) => {
          const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const containers = [
            ...document.querySelectorAll("table, [role='grid']")
          ];
          const dataContainer = containers.find((candidate) => {
            const text = normalize(candidate.innerText);
            return wantedColumns.some((column) => text.includes(column));
          }) || containers[0];
          if (!dataContainer) return;

          let scrollContainer = dataContainer.querySelector(
            "tbody tr, [role='row']"
          ) || dataContainer;
          while (scrollContainer && scrollContainer !== document.body) {
            const style = window.getComputedStyle(scrollContainer);
            const canScroll = /(auto|scroll)/.test(style.overflowY)
              && scrollContainer.scrollHeight > scrollContainer.clientHeight + 1;
            if (canScroll) break;
            scrollContainer = scrollContainer.parentElement;
          }
          if (!scrollContainer || scrollContainer === document.body) {
            scrollContainer = document.scrollingElement || document.documentElement;
          }

          const isDocumentScroll = scrollContainer === document.scrollingElement
            || scrollContainer === document.documentElement
            || scrollContainer === document.body;
          const clientHeight = isDocumentScroll ? window.innerHeight : scrollContainer.clientHeight;
          const currentTop = isDocumentScroll ? window.scrollY : scrollContainer.scrollTop;
          const nextTop = Math.min(
            scrollContainer.scrollHeight - clientHeight,
            currentTop + Math.max(300, Math.floor(clientHeight * 0.8))
          );

          if (isDocumentScroll) {
            window.scrollTo(0, nextTop);
          } else {
            scrollContainer.scrollTop = nextTop;
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
          }
        }
        """,
        wanted_columns,
    )


async def extract_all_rows(page: Any, wanted_columns: list[str]) -> list[dict[str, str]]:
    collected_rows: dict[str, dict[str, str]] = {}
    stable_rounds = 0
    previous_scroll_height: int | None = None
    previous_scroll_top: float | None = None
    column_mapping_logged = False

    while True:
        extraction = await extract_visible_rows(page, wanted_columns)
        visible_rows = extraction["rows"]
        if not column_mapping_logged:
            for requested, actual in extraction["matchedColumns"].items():
                if requested != actual:
                    log(f"Using Kibana column alias: {actual} -> {requested}")
            if extraction["missingColumns"]:
                log(
                    "WARNING: Kibana table is missing requested columns: "
                    + ", ".join(extraction["missingColumns"])
                )
            column_mapping_logged = True

        before_count = len(collected_rows)
        for row in visible_rows:
            collected_rows.setdefault(row["key"], row["item"])
        added_count = len(collected_rows) - before_count

        state = await get_scroll_state(page, wanted_columns)
        height_changed = (
            previous_scroll_height is not None
            and state["scrollHeight"] != previous_scroll_height
        )
        top_changed = (
            previous_scroll_top is not None
            and abs(state["top"] - previous_scroll_top) > 1
        )

        if added_count > 0 or height_changed or top_changed:
            stable_rounds = 0
            if added_count > 0:
                log(f"Collected {len(collected_rows)} rows while scrolling...")
        else:
            stable_rounds += 1

        if not state["scrollable"]:
            break

        scroll_stalled = (
            previous_scroll_top is not None
            and abs(state["top"] - previous_scroll_top) <= 1
        )
        if stable_rounds >= 3 and (state["atBottom"] or scroll_stalled):
            break

        previous_scroll_height = state["scrollHeight"]
        previous_scroll_top = state["top"]
        await scroll_discover_table(page, wanted_columns)
        # 到达底部时多等待一会儿，让懒加载请求有机会追加新数据。
        await page.wait_for_timeout(1_000 if state["atBottom"] else 500)

    return list(collected_rows.values())


async def crawl(args: argparse.Namespace) -> dict[str, Any]:
    launch_options = {"headless": not args.headed}
    context_options: dict[str, Any] = {}
    if args.storage_state:
        context_options["storage_state"] = args.storage_state

    cdp_url = args.cdp_url
    if args.existing_chrome and not cdp_url:
        log("Auto-detecting existing Chrome CDP endpoint...")
        cdp_url = find_existing_chrome_cdp_url()
        if not cdp_url:
            raise RuntimeError(
                "No connectable existing Chrome was found. "
                "Chrome must be started with --remote-debugging-port, for example: "
                "open -na 'Google Chrome' --args --remote-debugging-port=9222"
            )

    async with async_playwright() as p:
        if cdp_url:
            log(f"Connecting to existing Chrome via CDP: {cdp_url}")
            browser = await p.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else await browser.new_context(**context_options)
        else:
            log("Launching Chromium...")
            browser = await p.chromium.launch(**launch_options)
            context = await browser.new_context(**context_options)

        if args.check_connection_only:
            version = await browser.version()
            await browser.close()
            return {
                "project": args.project,
                "source_url": args.url,
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "columns": args.columns,
                "total": 0,
                "errors": [],
                "connection_check": {"ok": True, "browser_version": version, "cdp_url": cdp_url},
            }

        page = await context.new_page()

        log("Opening Kibana URL...")
        await page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout)
        await login_if_needed(page, args)
        has_table = await wait_for_discover_table(page, args.timeout)
        if has_table:
            log("Extracting all table rows with automatic scrolling...")
            rows = await extract_all_rows(page, args.columns)
        else:
            rows = []

        if args.save_storage_state:
            log(f"Saving storage state to {args.save_storage_state}...")
            await context.storage_state(path=args.save_storage_state)

        await browser.close()

    return {
        "project": args.project,
        "source_url": args.url,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "columns": args.columns,
        "total": len(rows),
        "errors": rows,
    }


async def main() -> None:
    args = parse_args()
    data = await crawl(args)
    if args.check_connection_only:
        print(json.dumps(data["connection_check"], ensure_ascii=False, indent=2))
        return
    path = output_path(args.output_dir, args.project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {data['total']} rows to {path}")


if __name__ == "__main__":
    asyncio.run(main())
