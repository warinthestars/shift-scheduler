#!/usr/bin/env python3
"""
Phase 35.1.1: sort ShiftBoard's settings into its three settings files.

    .env                        ordinary settings, no secrets
    .secrets/stack.env          stack secrets (database, Redis, tunnel, backend read it)
    .secrets/integrations.env   outside-service keys (only the backend reads it)

Works from any earlier layout:
    0.35.0 and older   .env + backend/.env + frontend/.env + .secrets/.secrets.env
    0.35.1             everything in the root .env
It keeps exactly the values the running app uses, puts each one in the right file, and renames
the old files to <name>.pre-0.35.2.bak so nothing is lost (git ignores them).

It NEVER prints a value, only setting names and which file each came from / goes to.

    python scripts/consolidate_env.py            # dry run: shows what it would do, changes nothing
    python scripts/consolidate_env.py --apply    # writes the three files and renames the old ones
    python scripts/consolidate_env.py --undo     # puts the old files back
    python scripts/consolidate_env.py --source .env.old.env   # read the root settings from another file

Template placeholders (your_..._here) are never carried over: the script refuses to --apply
while a secret the stack needs is still a placeholder.

Run it from the repository root (the folder with docker-compose.yaml). Needs Python 3.8+ only.
No Python on this computer? Use Docker:
    docker run --rm -v "${PWD}:/work" -w /work python:3.11-slim python scripts/consolidate_env.py --apply

Which value wins (what 0.35.0 / 0.35.1 actually used):
  * Values that docker-compose.yml substituted with ${...} (database / Redis passwords, ports,
    super-admin login, tunnel token) came ONLY from the root .env. So the root .env value wins.
    If the root .env didn't have it, Compose's built-in default was used: the same default is
    kept (written out where the new layout needs it), unless Compose had no default, in which
    case the value from the other files is used and flagged CHECK IT.
  * Everything else reached the backend through env_file, where the later file won:
    .secrets/.secrets.env  >  backend/.env  >  root .env.
  * DATABASE_URL, REDIS_URL and POSTGRES_HOST are built for you now: dropped.
  * CLOUDFLARE_TUNNEL_TOKEN is renamed TUNNEL_TOKEN (the name cloudflared reads by itself).
  * frontend/.env: the web app reads no settings, so nothing is taken from it.
"""
import argparse
import os
import re
import sys
from pathlib import Path

SUFFIX = ".pre-0.35.2.bak"
ROOT_ENV = Path(".env")
STACK = Path(".secrets/stack.env")
INTEGRATIONS = Path(".secrets/integrations.env")
SOURCES = [  # lowest priority first (env_file order before 0.35.1; later wins)
    ("root .env", Path(".env")),
    ("backend/.env", Path("backend/.env")),
    (".secrets/.secrets.env", Path(".secrets/.secrets.env")),
]
FRONTEND = Path("frontend/.env")
RETIRE = [Path("backend/.env"), FRONTEND, Path(".secrets/.secrets.env")]

# ${...} in the old docker-compose.yml -> their compose default (None = no default)
INTERPOLATED = {
    "POSTGRES_USER": "shiftboard_user",
    "POSTGRES_PASSWORD": None,
    "POSTGRES_DB": "shiftboard",
    "POSTGRES_PORT": "5432",
    "REDIS_PASSWORD": "shiftboard_redis_pass",
    "REDIS_PORT": "6379",
    "PORT_BACKEND": "8000",
    "PORT_FRONTEND": "80",
    "SUPER_ADMIN_USERNAME": "demo_admin@shiftboard.com",
    "SUPER_ADMIN_PASSWORD": "SuperSecretDemo123!",
    "CLOUDFLARE_TUNNEL_TOKEN": None,
}
# Defaults that must be written out because the new layout has no fallback for them
WRITE_DEFAULT = {"REDIS_PASSWORD"}
COMPUTED = {"DATABASE_URL", "REDIS_URL", "POSTGRES_HOST"}
RENAMED = {"CLOUDFLARE_TUNNEL_TOKEN": "TUNNEL_TOKEN"}

STACK_KEYS = ["POSTGRES_PASSWORD", "REDIS_PASSWORD", "SECRET_KEY", "SUPER_ADMIN_PASSWORD", "TUNNEL_TOKEN"]
INTEGRATION_KEYS = ["SMTP_USERNAME", "SMTP_PASSWORD", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
                    "VAPID_PRIVATE_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]

# The layout of the new .env (same order as .env.template); no secrets
SECTIONS = [
    ("Database (PostgreSQL)", ["POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PORT", "DB_POOL_SIZE", "DB_MAX_OVERFLOW"]),
    ("Redis", ["REDIS_PORT"]),
    ("Ports on your computer", ["PORT_BACKEND", "PORT_FRONTEND"]),
    ("Backend and sign-in", ["ENV", "DEBUG", "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "SUPER_ADMIN_USERNAME",
                             "ALWAYS_ADMIN_EMAILS", "ALLOW_SELF_REGISTRATION", "SHOW_DEMO_LOGINS"]),
    ("Firebase", ["USE_MOCK_FIREBASE", "FIREBASE_AUTH_PROVIDERS", "FIREBASE_WEB_CONFIG_PATH",
                  "FIREBASE_CREDENTIALS_PATH", "FIREBASE_VAPID_KEY"]),
    ("ShiftBoard's own Web Push", ["VAPID_SUBJECT"]),
    ("Notifications", ["APP_BASE_URL", "NOTIFICATIONS_WORKER_ENABLED", "NOTIFICATIONS_DIGEST_HOUR",
                       "EMAIL_PROVIDER", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_STARTTLS", "SMTP_SSL",
                       "SMS_PROVIDER", "TWILIO_FROM_NUMBER"]),
    ("Cloudflare R2 (reserved: not used by the app yet)", ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_S3_ENDPOINT_URL",
                                                          "R2_PUBLIC_URL_PREFIX"]),
]
KNOWN_PLAIN = {k for _, keys in SECTIONS for k in keys}
# Read by nothing in ShiftBoard 0.35.x. Kept (so nothing is lost) in their own section.
UNUSED = {
    "JWT_SECRET_KEY": "not used: logins are signed with SECRET_KEY",
    "JWT_ALGORITHM": "not used: always HS256",
    "ALGORITHM": "not used: always HS256",
    "CORS_ORIGINS": "not used: the allowed origins are set in backend/src/main.py",
    "FIREBASE_PROJECT_ID": "not used: the project comes from .secrets/firebase-web-config.js",
    "DEFAULT_GEOFENCE_RADIUS_METERS": "not used: each venue sets its own clock-in area",
    "PORT": "not used in Docker",
    "PROJECT_NAME": "not used", "ENVIRONMENT": "not used (ENV is)", "LOG_LEVEL": "not used",
    "APP_DOMAIN": "not used", "CLOUDFLARE_TUNNEL_ID": "not used (the tunnel runs with TUNNEL_TOKEN)",
}
PLACEHOLDER = re.compile(r"^[\"']?your_[A-Za-z0-9_]*_here[\"']?$")
SECRET_WORDS = re.compile(r"(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE|_KEY$|_SID$|CREDENTIAL)")

KEY_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


def parse(path: Path):
    """KEY -> raw value text exactly as written (quotes kept). Later duplicates win, like Compose.
    Multi-line values in double or single quotes are kept whole. Returns (values, problems)."""
    values, problems = {}, []
    if not path.exists():
        return values, problems
    lines = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = KEY_RE.match(line)
        if not m:
            problems.append(f"{path}: line {i} isn't KEY=VALUE, skipped")
            continue
        key, raw = m.group(1), m.group(2).strip()
        if raw[:1] in ('"', "'"):
            q = raw[0]
            body = raw[1:]
            closed = re.search(r"(?<!\\)" + re.escape(q), body) if q == '"' else (q in body)
            if not closed:  # multi-line quoted value
                start = i
                buf = [raw]
                while i < len(lines):
                    buf.append(lines[i])
                    i += 1
                    if (re.search(r"(?<!\\)" + re.escape(q), lines[i - 1]) if q == '"' else q in lines[i - 1]):
                        break
                else:
                    problems.append(f"{path}: {key} starts a quoted value on line {start} that never closes; skipped")
                    continue
                raw = "\n".join(buf)
        values[key] = raw
    return values, problems


def is_blank(raw):
    return raw is None or raw.strip().strip('"').strip("'").strip() == ""


def plan():
    files = {label: parse(p) for label, p in SOURCES}
    placeholders = set()
    for label, (values, _) in files.items():
        for k, v in list(values.items()):
            if PLACEHOLDER.match(v.strip()):
                placeholders.add(k)
                del values[k]
    fe_values, fe_problems = parse(FRONTEND)
    problems = [p for _, (_, probs) in files.items() for p in probs] + fe_problems
    root_label = SOURCES[0][0]
    root = files[root_label][0]
    merged, origin, notes = {}, {}, []

    all_keys = []
    for label, _ in SOURCES:
        for k in files[label][0]:
            if k not in all_keys:
                all_keys.append(k)

    for key in all_keys:
        where = [(label, files[label][0][key]) for label, _ in SOURCES if key in files[label][0]]
        if key in COMPUTED:
            notes.append(f"{key}: dropped (built for you now)")
            continue
        if key in INTERPOLATED:
            others = [l for l, v in where if l != root_label and not is_blank(v)]
            root_blank = key in root and is_blank(root[key])
            if key in root and root_blank and INTERPOLATED[key] is None and others:
                label = others[-1]
                merged[key], origin[key] = files[label][0][key], label
                notes.append(f"{key}: empty in the root .env; taken from {label}. CHECK IT: Docker was not using it before.")
            elif key in root and not (root_blank and INTERPOLATED[key] is not None):
                merged[key], origin[key] = root[key], root_label
                differs = [l for l, v in where if l != root_label and v != root[key]]
                if differs:
                    notes.append(f"{key}: kept the root .env value (the one Docker used); a different value in "
                                 f"{', '.join(differs)} was never used and is dropped")
            elif INTERPOLATED[key] is not None:
                if others:
                    notes.append(f"{key}: not set in the root .env, so Docker used its built-in default; the value in "
                                 f"{', '.join(others)} was never used. Kept the default.")
            elif others:
                label = others[-1]
                merged[key], origin[key] = files[label][0][key], label
                notes.append(f"{key}: not in the root .env; taken from {label}. CHECK IT: Docker was not using it before.")
            continue
        label, value = where[-1]  # later file wins
        merged[key], origin[key] = value, label
        losers = [l for l, v in where[:-1] if v != value]
        if losers:
            notes.append(f"{key}: {label} wins over {', '.join(losers)} (same as before)")

    # Defaults the new layout needs written out
    for key in WRITE_DEFAULT:
        if key not in merged:
            merged[key], origin[key] = INTERPOLATED[key], "built-in default"
            notes.append(f"{key}: Docker was using the built-in default; written out so Redis keeps the same "
                         f"password. Consider changing it in .secrets/stack.env (then recreate the containers).")
    # Renames
    for old, new in RENAMED.items():
        if old in merged:
            if new in merged:
                notes.append(f"{old}: {new} is also set; kept {new}")
                merged.pop(old)
                origin.pop(old)
            else:
                merged[new] = merged.pop(old)
                origin[new] = origin.pop(old)
                notes.append(f"{old}: renamed {new} (cloudflared reads that name by itself)")

    if is_blank(merged.get("SECRET_KEY")):
        extra = " (only JWT_SECRET_KEY, which ShiftBoard doesn't read)" if not is_blank(merged.get("JWT_SECRET_KEY")) else ""
        notes.append(f"WARNING SECRET_KEY is not set{extra}: logins are signed with the built-in public fallback "
                     "key. Set SECRET_KEY in .secrets/stack.env to a long random value; everyone is signed out once.")
    if is_blank(merged.get("POSTGRES_PASSWORD")):
        notes.append("WARNING POSTGRES_PASSWORD is not set anywhere: the backend can't reach the database.")
    if is_blank(merged.get("TUNNEL_TOKEN")):
        notes.append("WARNING TUNNEL_TOKEN is not set: the Cloudflare tunnel won't connect.")
    if placeholders:
        notes.append("WARNING still template placeholders (your_..._here), not carried over: " + ", ".join(sorted(placeholders)))
    fe_keys = sorted(fe_values)
    if fe_keys:
        notes.append(f"frontend/.env: {', '.join(fe_keys)} not carried over (the web app reads no settings)")
    return merged, origin, notes, problems, placeholders


def destination(key):
    if key in STACK_KEYS:
        return "stack"
    if key in INTEGRATION_KEYS:
        return "integrations"
    if key in KNOWN_PLAIN:
        return "env"
    # Unknown or unused: anything that looks secret goes to the backend-only file
    return "integrations" if SECRET_WORDS.search(key) else "env"


HEADERS = {
    "env": ["ShiftBoard: ordinary settings (NO secrets). Explained in .env.template."],
    "stack": ["ShiftBoard: stack secrets. Read by database, redis, cloudflared and backend.",
              "Explained in .secrets/stack.env.template."],
    "integrations": ["ShiftBoard: keys for outside services. Read by the backend only.",
                     "Explained in .secrets/integrations.env.template."],
}


def render(merged, which):
    out = ["# ==============================================================================",
           *[f"# {h}" for h in HEADERS[which]],
           "# Made by scripts/consolidate_env.py (your old files are kept as *.pre-0.35.2.bak).",
           "# After changing it: docker compose up -d --force-recreate   (keeps your data)",
           "# =============================================================================="]
    keys = [k for k in merged if destination(k) == which]
    done = set()
    if which == "env":
        for title, section in SECTIONS:
            present = [k for k in section if k in merged]
            if present:
                out += ["", f"# --- {title}"] + [f"{k}={merged[k]}" for k in present]
                done.update(present)
    else:
        order = STACK_KEYS if which == "stack" else INTEGRATION_KEYS
        present = [k for k in order if k in merged]
        if present:
            out += [""] + [f"{k}={merged[k]}" for k in present]
            done.update(present)
    other = [k for k in keys if k not in done and k not in UNUSED]
    unused = [k for k in keys if k not in done and k in UNUSED]
    if other:
        out += ["", "# --- Other settings kept from your old files (not in the templates)"]
        out += [f"{k}={merged[k]}" for k in other]
    if unused:
        out += ["", "# --- Not read by ShiftBoard (kept so nothing is lost; safe to delete)"]
        for k in unused:
            out += [f"# {UNUSED[k]}", f"{k}={merged[k]}"]
    return "\n".join(out) + "\n"


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the three files and rename the old ones")
    ap.add_argument("--undo", action="store_true", help="restore the files renamed by --apply")
    ap.add_argument("--source", help="read the root settings from this file instead of .env "
                                     "(it is renamed to <file>.pre-0.35.2.bak on --apply)")
    args = ap.parse_args()
    global SOURCES
    source = Path(args.source) if args.source else ROOT_ENV
    if args.source:
        if not source.exists():
            sys.exit(f"{source} doesn't exist. Nothing changed.")
        SOURCES = [(f"{source}", source)] + SOURCES[1:]
    if not (Path("docker-compose.yaml").exists() or Path("docker-compose.yml").exists()):
        sys.exit("Run this from the repository root (the folder with docker-compose.yaml).")

    if args.undo:
        restored = 0
        extra = [p.with_name(p.name[:-len(SUFFIX)]) for p in Path(".").glob("*" + SUFFIX)
                 if p.name != ROOT_ENV.name + SUFFIX and ".undone" not in p.name]
        for p in [ROOT_ENV] + RETIRE + extra:
            bak = p.with_name(p.name + SUFFIX)
            if bak.exists():
                os.replace(bak, p)
                print(f"restored {p}")
                restored += 1
        if restored:
            for p in (STACK, INTEGRATIONS):
                if p.exists():
                    os.replace(p, p.with_name(p.name + ".undone" + SUFFIX))
                    print(f"moved {p} aside -> {p}.undone{SUFFIX}")
        print("Nothing to undo." if not restored else "Done. Recreate the containers after restoring the matching code.")
        return

    existing = [str(p) for p in [ROOT_ENV] + RETIRE if p.with_name(p.name + SUFFIX).exists()]
    existing += [str(p) for p in (STACK, INTEGRATIONS) if p.exists()]
    if existing:
        sys.exit("Already split: " + ", ".join(existing) + " exist(s). Nothing changed. "
                 "Use --undo first to start over.")
    if not any(p.exists() for _, p in SOURCES):
        sys.exit("No settings files found (.env, backend/.env, .secrets/.secrets.env). Copy the three "
                 ".template files instead (.env.template, .secrets/stack.env.template, .secrets/integrations.env.template).")

    merged, origin, notes, problems, placeholders = plan()
    names = {"env": ".env", "stack": str(STACK), "integrations": str(INTEGRATIONS)}
    for which, name in names.items():
        keys = [k for k in merged if destination(k) == which]
        print(f"{name}: {len(keys)} settings" + (f": {', '.join(sorted(keys))}" if keys else ""))
    for label in [l for l, _ in SOURCES] + ["built-in default"]:
        keys = sorted(k for k, o in origin.items() if o == label)
        if keys:
            print(f"  values from {label}: {', '.join(keys)}")
    for n in notes + problems:
        print(("! " if n.startswith("WARNING") or "CHECK" in n else "- ") + n)
    moved = sorted(k for k in merged if destination(k) == "integrations" and k not in INTEGRATION_KEYS and k not in UNUSED)
    if moved:
        print("! " + ", ".join(moved) + ": not a known setting but looks secret, so it goes in "
              ".secrets/integrations.env (backend only). CHECK IT.")

    blocking = sorted(k for k in placeholders if k in ("POSTGRES_PASSWORD", "SECRET_KEY", "REDIS_PASSWORD")
                      and is_blank(merged.get(k)))
    if blocking:
        print(f"\n! {', '.join(blocking)} only exist as template placeholders in {source}. It looks like a copy of "
              ".env.template, not your real settings. Nothing changed. If your real settings are in another file, "
              "run again with --source <that file>.")
        sys.exit(1)
    if not args.apply:
        print("\nDry run: nothing changed. Run again with --apply to write the files and rename the old ones.")
        return

    contents = {w: render(merged, w) for w in names}
    for p in dict.fromkeys([source, ROOT_ENV]):
        if p.exists():
            os.replace(p, p.with_name(p.name + SUFFIX))
            print(f"renamed {p} -> {p}{SUFFIX}")
    for p in RETIRE:
        if p.exists():
            os.replace(p, p.with_name(p.name + SUFFIX))
            print(f"renamed {p} -> {p}{SUFFIX}")
    write(ROOT_ENV, contents["env"])
    write(STACK, contents["stack"])
    write(INTEGRATIONS, contents["integrations"])
    print("\nDone. Check with:  docker compose config --quiet   (prints nothing when it's fine)\n"
          "Then recreate the containers (keeps your data):  docker compose up -d --build --force-recreate")


if __name__ == "__main__":
    main()
