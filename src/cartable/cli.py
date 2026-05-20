"""Command-line interface."""

from __future__ import annotations

import argparse
import json
import logging
import sys

from . import client as client_mod
from . import config as config_mod
from . import db as db_mod
from . import sync as sync_mod


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cartable", description="Local Pronote sync.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable debug logging.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("sync", help="Fetch fresh data from Pronote into the local DB.")
    sub.add_parser("init", help="Create the SQLite schema (idempotent).")
    sub.add_parser("status", help="Show the last sync attempt.")
    sub.add_parser("list-ents", help="List supported ENT providers.")
    sub.add_parser("login-test", help="Try to log in and print the student name.")

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.cmd == "list-ents":
        for name in client_mod.list_ent_providers():
            print(name)
        return 0

    cfg = config_mod.load()

    if args.cmd == "init":
        conn = db_mod.connect(cfg.db_path)
        db_mod.init_schema(conn)
        conn.close()
        print(f"Initialised {cfg.db_path}")
        return 0

    if args.cmd == "status":
        conn = db_mod.connect(cfg.db_path)
        db_mod.init_schema(conn)
        row = conn.execute(
            "SELECT started_at, finished_at, success, error, counts_json "
            "FROM sync_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        conn.close()
        if not row:
            print("No sync has been recorded yet.")
            return 0
        print(f"Last sync started:  {row['started_at']}")
        print(f"Last sync finished: {row['finished_at']}")
        print(f"Success:            {bool(row['success'])}")
        if row["counts_json"]:
            for k, v in json.loads(row["counts_json"]).items():
                print(f"  {k:14s} {v}")
        if row["error"]:
            print(f"Error: {row['error'].splitlines()[0]}")
        return 0

    if args.cmd == "login-test":
        import pronotepy
        client = client_mod.login(cfg)
        info = client_mod.active_student_info(client)
        if isinstance(client, pronotepy.ParentClient):
            print(f"Parent account — children: {[c.name for c in client.children]}")
            print(f"Selected child: {info.name}")
        else:
            print(f"Student account — logged in as: {info.name}")
        print(f"Class:         {info.class_name}")
        print(f"Establishment: {info.establishment}")
        return 0

    if args.cmd == "sync":
        counts = sync_mod.run(cfg)
        print("Sync complete:")
        for k, v in counts.as_dict().items():
            print(f"  {k:14s} {v}")
        return 0

    parser.error(f"Unknown command {args.cmd!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
