"""
Phase 35.3: demo data. Fills a ShiftUp database with a realistic "has been running for a while" example:
several venues set up differently, about 70 people, weeks of finished events with clock-ins, tips, ratings and
pay periods, events happening today, and upcoming events with requests, offers, cover requests and waitlists.

Run it inside the backend container (the app must have started once, so the tables exist):

    docker compose exec backend python -m src.demo_data status
    docker compose exec backend python -m src.demo_data load
    docker compose exec backend python -m src.demo_data reset      # clear, then load again (fresh dates)
    docker compose exec backend python -m src.demo_data clear      # remove the demo data only

Options for load / reset:
    --weeks-back 8            how much history (1-26)
    --weeks-ahead 3           how far ahead (1-8)
    --seed 35                 same number = the same people and events
    --password Demo12345!     the one password every demo account gets
    --manager-email a@b.com   also make this EXISTING account a manager of every demo venue (repeatable)

What it touches:
  * Demo venues have fixed ids and demo accounts all end in @demo.example.com (example.com can never receive
    mail). `clear` deletes exactly those venues and accounts, and everything hanging off them. Nothing else.
  * Everything is dated relative to the moment you run it, so there is always something live today.
  * Rows are written directly: no emails, texts or push are sent, and demo accounts have email / text turned off.
  * One transaction: if anything fails, nothing is written.
"""
import argparse
import asyncio
import random
import secrets
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from src.auth import get_password_hash
from src.database import AsyncSessionLocal, Base
from src.models import (
    CoverRequest, EventTemplate, EventTip, NotificationPreference, Organization, OrganizationMember, PayPeriodApproval, Rating, Shift,
    ShiftBoardMessage, ShiftEvent, ShiftOffer, ShiftRequest, ShiftTransfer, TimeEntry, TimeEntryEdit, TimeOffBlock,
    User, Venue, VenueActivity, VenueInvite, VenueLocation, VenueManager, VenuePosition, VenueWhitelist,
    WaitlistEntry, WorkerAvailability, WorkerCertification,
)
from src.services import pay_periods as pp
from src.services.activity import CATEGORY, short_when
from src.services.time_tracking import PAYROLL, resolve
from src.services.timesheets import fmt_range

DOMAIN = "demo.example.com"
NS = uuid.UUID("5b1f0c35-0000-4000-8000-5eedda7a0353")
DEFAULT_PASSWORD = "Demo12345!"
NO_SHOW_RELEASED = "no_show:spot_released"
UTC = timezone.utc


def uid(key: str) -> uuid.UUID:
    return uuid.uuid5(NS, key)


ORG_NAME = "Whitaker Hospitality Group"          # Phase 36: the demo organization (Harbor House + Copperline)
ORG_IDS = [uid("org:whitaker")]


# ------------------------------------------------------------------------------------------------
# What gets built
# ------------------------------------------------------------------------------------------------
# position: (name, department, rate, rate_max, tips_eligible, tip_pool, required_certs)
# roster:   (how many, [positions], staffing company or None, time-tracking override or None)
# pattern:  (title, weekday 0=Mon, "HH:MM", hours, [(position, capacity)], chance per week, location or None)
VENUES = [
    dict(
        key="marlowe", name="The Marlowe Theatre", tz="America/New_York",
        address="231 W 45th St, New York, NY 10036", lat=40.7586, lng=-73.9870, phone="(212) 555-0142",
        website="https://marlowe-theatre.example.com",
        description="A 1,100-seat Broadway-district house: touring shows, concerts and corporate rentals.",
        manager=("Priya", "Raman"),
        settings=dict(approval_policy="team_auto", team_time_tracking="payroll", pay_period="biweekly",
                      ot_weekly_hours=40, ot_daily_hours=10, tips_enabled=True, tip_pool_split="hours",
                      tip_pool_payroll=True, geofence_enabled=False,
                      arrival_instructions="Stage door on 46th St. Sign in with security; badges at the call board.",
                      dress_code="Show blacks, closed-toe shoes. Ushers: house vest provided.",
                      default_shift_notes="Half-hour call is firm. Phones off backstage."),
        positions=[("Stagehand", "tech", 30, 36, False, False, []), ("AV Tech", "tech", 36, None, False, False, []),
                   ("Usher", "foh", 18, None, False, False, []),
                   ("Bartender", "bar", 16, None, True, True, ["alcohol_server"]),
                   ("Security", "security", 24, None, False, False, ["security_license"]),
                   ("Load-in Crew", "ops", 26, None, False, False, [])],
        roster=[(6, ["Stagehand", "Load-in Crew"], None, None), (3, ["AV Tech", "Stagehand"], None, None),
                (5, ["Usher"], None, None), (3, ["Bartender"], None, None),
                (4, ["Stagehand", "Load-in Crew"], "Pro Staffing LLC", None),
                (2, ["Load-in Crew"], "Local 12 Crew", None),
                (2, ["Security"], "Sentinel Security Group", None)],
        patterns=[("Evening Performance", 3, "18:00", 5, [("Stagehand", 3), ("AV Tech", 1), ("Usher", 3), ("Bartender", 2), ("Security", 1)], 0.95, None),
                  ("Evening Performance", 4, "18:00", 5, [("Stagehand", 3), ("AV Tech", 1), ("Usher", 3), ("Bartender", 2), ("Security", 1)], 1.0, None),
                  ("Evening Performance", 5, "18:00", 5.5, [("Stagehand", 4), ("AV Tech", 2), ("Usher", 4), ("Bartender", 2), ("Security", 2)], 1.0, None),
                  ("Sunday Matinee", 6, "12:30", 4.5, [("Stagehand", 2), ("AV Tech", 1), ("Usher", 3), ("Bartender", 1)], 0.8, None),
                  ("Load-in & Focus", 0, "08:00", 10.5, [("Load-in Crew", 5), ("Stagehand", 3), ("AV Tech", 1)], 0.5, None)],
    ),
    dict(
        key="harbor", name="Harbor House Events", tz="America/Chicago",
        address="455 N Cityfront Plaza Dr, Chicago, IL 60611", lat=41.8902, lng=-87.6200, phone="(312) 555-0177",
        website="https://harborhouse.example.com",
        description="Lakefront catering and events: weddings, corporate dinners and off-site service.",
        manager=("Marcus", "Bell"),
        settings=dict(approval_policy="team_auto", team_time_tracking="shiftboard", pay_period="weekly",
                      ot_weekly_hours=40, ot_daily_hours=None, tips_enabled=True, tip_pool_split="hours",
                      geofence_enabled=True, geofence_radius_meters=150, geofence_buffer_meters=150,
                      auto_approve_rating_threshold=4.6,
                      arrival_instructions="Loading dock on Illinois St, service elevator to level 2.",
                      dress_code="Black bistro: black shirt, black slacks, non-slip shoes.",
                      default_shift_notes="Family meal 45 minutes before doors."),
        positions=[("Server", "foh", 20, None, True, True, []), ("Bartender", "bar", 22, None, True, True, ["alcohol_server"]),
                   ("Banquet Captain", "foh", 28, 32, False, False, []),
                   ("Prep Cook", "kitchen", 21, None, False, False, ["food_handler"]),
                   ("Dishwasher", "kitchen", 18, None, False, False, []), ("Setup Crew", "ops", 19, None, False, False, [])],
        roster=[(7, ["Server"], None, None), (3, ["Bartender", "Server"], None, None), (2, ["Banquet Captain", "Server"], None, None),
                (3, ["Prep Cook", "Dishwasher"], None, None), (3, ["Setup Crew", "Dishwasher"], None, None)],
        locations=[("Lakeside Pavilion", "1 Lakefront Trail, Chicago, IL 60611", 41.8925, -87.6105, 200),
                   ("Museum Atrium", "220 E Chicago Ave, Chicago, IL 60611", 41.8972, -87.6210, 120)],
        patterns=[("Corporate Dinner", 2, "17:00", 5, [("Server", 4), ("Bartender", 1), ("Banquet Captain", 1), ("Prep Cook", 1), ("Dishwasher", 1)], 0.85, None),
                  ("Gala Dinner", 3, "16:30", 6, [("Server", 5), ("Bartender", 2), ("Banquet Captain", 1), ("Prep Cook", 2), ("Setup Crew", 2)], 0.7, "Museum Atrium"),
                  ("Wedding Reception", 5, "15:00", 8.5, [("Server", 6), ("Bartender", 2), ("Banquet Captain", 1), ("Prep Cook", 2), ("Dishwasher", 1), ("Setup Crew", 2)], 1.0, "Lakeside Pavilion"),
                  ("Sunday Brunch Buffet", 6, "09:00", 5.5, [("Server", 4), ("Bartender", 1), ("Prep Cook", 1), ("Dishwasher", 1)], 0.9, None)],
        busy_week=dict(weeks_ago=2, title="Convention Catering", start="07:30", hours=9.5,
                       positions=[("Server", 3), ("Prep Cook", 1), ("Setup Crew", 1)]),
    ),
    dict(
        key="copperline", name="Copperline Taproom", tz="America/Denver",
        address="2700 Walnut St, Denver, CO 80205", lat=39.7608, lng=-104.9836, phone="(303) 555-0119",
        website="https://copperline.example.com",
        description="Neighborhood brewery taproom with a kitchen, trivia and live music.",
        manager=("Dana", "Okafor"),
        settings=dict(approval_policy="everyone_auto", team_time_tracking="shiftboard", pay_period="semimonthly",
                      ot_weekly_hours=40, ot_daily_hours=None, work_week_start=2, tips_enabled=True,
                      tip_pool_split="equal", geofence_enabled=False,
                      city="RiNo, Denver",                                    # Phase 36: typed city for the public board
                      arrival_instructions="Side door by the patio. Aprons are behind the bar.",
                      dress_code="Copperline tee (we have spares), jeans, closed-toe shoes."),
        positions=[("Bartender", "bar", 15, None, True, True, ["alcohol_server"]), ("Barback", "bar", 16, None, True, True, []),
                   ("Server", "foh", 12, None, True, False, []), ("Line Cook", "kitchen", 20, 23, False, False, ["food_handler"]),
                   ("Door", "security", 18, None, False, False, [])],
        roster=[(4, ["Bartender", "Barback"], None, None), (4, ["Server"], None, None), (2, ["Line Cook"], None, None),
                (2, ["Door", "Barback"], None, None)],
        patterns=[("Trivia Night", 1, "18:00", 5, [("Bartender", 2), ("Server", 2), ("Line Cook", 1)], 0.95, None),
                  ("Live Music Friday", 4, "17:00", 7.5, [("Bartender", 2), ("Barback", 1), ("Server", 2), ("Line Cook", 1), ("Door", 1)], 1.0, None),
                  ("Saturday Service", 5, "12:00", 9, [("Bartender", 2), ("Barback", 1), ("Server", 3), ("Line Cook", 2), ("Door", 1)], 1.0, None)],
    ),
    dict(
        key="juniper", name="Juniper Rooftop", tz="America/Los_Angeles",
        address="1717 Vine St, Los Angeles, CA 90028", lat=34.1023, lng=-118.3267, phone="(323) 555-0164",
        website="https://juniper-rooftop.example.com",
        description="Rooftop cocktail bar and private-event space in Hollywood.",
        manager=("Elena", "Voss"),
        settings=dict(approval_policy="manual", team_time_tracking="shiftboard", pay_period="monthly",
                      pay_period_approval=False, ot_weekly_hours=40, ot_daily_hours=8, tips_enabled=False,
                      show_rates_publicly=False, allow_public_cover=False, geofence_enabled=False,
                      public_board=False,                                     # Phase 36: this venue stays off the public board
                      arrival_instructions="Check in with the host stand on 12. Staff lockers on 11.",
                      dress_code="All black, elevated. No logos."),
        positions=[("Host", "foh", 19, None, False, False, []), ("Server", "foh", 17, None, False, False, []),
                   ("Bartender", "bar", 21, 25, False, False, ["alcohol_server"]), ("Busser", "foh", 16, None, False, False, []),
                   ("Security", "security", 25, None, False, False, ["security_license"])],
        roster=[(2, ["Host"], None, None), (4, ["Server", "Busser"], None, None), (3, ["Bartender"], None, None),
                (2, ["Busser"], None, None), (1, ["Security"], "Sentinel Security Group", None)],
        patterns=[("Sunset Service", 3, "16:00", 7, [("Host", 1), ("Server", 3), ("Bartender", 2), ("Busser", 1)], 0.9, None),
                  ("Sunset Service", 4, "16:00", 8, [("Host", 1), ("Server", 3), ("Bartender", 2), ("Busser", 2), ("Security", 1)], 1.0, None),
                  ("Sunset Service", 5, "16:00", 8.5, [("Host", 2), ("Server", 4), ("Bartender", 3), ("Busser", 2), ("Security", 1)], 1.0, None)],
    ),
    dict(
        key="riverside", name="Riverside Convention Center", tz="America/New_York",
        address="1101 Arch St, Philadelphia, PA 19107", lat=39.9546, lng=-75.1596, phone="(215) 555-0190",
        website="https://riverside-cc.example.com",
        description="Convention center: trade shows, conferences and banquets, with large event-day crews.",
        manager=("Tom", "Iwata"),
        settings=dict(approval_policy="team_auto", team_time_tracking="payroll", pay_period="weekly",
                      ot_weekly_hours=40, ot_daily_hours=8, tips_enabled=True, tip_pool_split="hours",
                      tip_pool_payroll=False, geofence_enabled=True, geofence_radius_meters=250,
                      geofence_buffer_meters=200,
                      arrival_instructions="Staff entrance on 12th St, Hall B. Pick up your credential at the labor desk.",
                      dress_code="Black polo, khakis. Setup crew: work boots.",
                      default_shift_notes="30-minute unpaid meal break on shifts over 6 hours."),
        positions=[("Event Staff", "ops", 18, None, False, False, []), ("Registration Desk", "foh", 19, None, False, False, []),
                   ("AV Tech", "tech", 34, 38, False, False, []), ("Security", "security", 24, None, False, False, ["security_license"]),
                   ("Concessions", "foh", 15, None, True, True, ["food_handler"]), ("Setup Crew", "ops", 20, None, False, False, [])],
        roster=[(5, ["Event Staff", "Registration Desk"], None, None), (2, ["AV Tech"], None, None),
                (3, ["Concessions"], None, "shiftboard"), (4, ["Event Staff", "Setup Crew"], "Pro Staffing LLC", None),
                (3, ["Setup Crew"], "Keystone Labor", None), (2, ["Security"], "Sentinel Security Group", None)],
        patterns=[("Conference General Session", 1, "07:00", 9.5, [("Event Staff", 4), ("Registration Desk", 2), ("AV Tech", 1), ("Security", 1), ("Concessions", 2)], 0.9, None),
                  ("Conference General Session", 2, "07:00", 9.5, [("Event Staff", 4), ("Registration Desk", 2), ("AV Tech", 1), ("Security", 1), ("Concessions", 2)], 0.9, None),
                  ("Trade Expo", 4, "08:00", 8, [("Event Staff", 5), ("Registration Desk", 2), ("AV Tech", 2), ("Security", 2), ("Concessions", 3), ("Setup Crew", 3)], 0.75, None),
                  ("Expo Load-out", 5, "17:00", 6, [("Setup Crew", 5), ("Event Staff", 2)], 0.6, None)],
    ),
]

FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Nia", "Lucas", "Isla", "Mateo", "Ruby", "Kai", "Elena", "Omar",
         "Hazel", "Jonah", "Priya", "Diego", "Tessa", "Malik", "Chloe", "Andre", "Sofia", "Wes", "Naomi", "Felix", "Carmen",
         "Theo", "Leila", "Marcus", "Ivy", "Caleb", "Rosa", "Dev", "Quinn", "Hana", "Jude", "Bianca", "Silas", "Amara",
         "Reid", "Lena", "Tariq", "Mina", "Cole", "Yara", "Beau", "Gia", "Ezra", "Nora", "Luca", "Anika", "Owen", "Sage",
         "Ines", "Rafael", "Kira", "Jamal", "Elise", "Trent", "Asha", "Milo", "Vera", "Dante", "Joy", "Pablo", "Rhea",
         "Simon", "Talia", "Victor", "Wren", "Xavier", "Yusuf", "Zara", "Blake", "Cora"]
LAST = ["Alvarez", "Brooks", "Chen", "Dalton", "Ellis", "Fontaine", "Garcia", "Hayes", "Ibrahim", "Jensen", "Kowalski",
        "Lopez", "Morales", "Nguyen", "Ortiz", "Patel", "Quinn", "Reyes", "Sato", "Turner", "Usman", "Vega", "Walsh",
        "Xu", "Young", "Zamora", "Abbott", "Bishop", "Castro", "Diaz", "Flores", "Grant", "Howard", "James", "Kim",
        "Lambert", "Mills", "Novak", "Owens", "Price"]
REVIEWS = {
    5: ["Fantastic. Guests asked for them by name.", "Early, sharp and calm under pressure.", "Ran their section without a hitch.",
        "Exactly who you want on a busy night.", None, None],
    4: ["Solid shift, would book again.", "Good energy, needed a little direction at the start.", None, None],
    3: ["Fine, but slow on resets.", "Arrived right at call; okay once going.", None],
    2: ["Late and on their phone a lot.", "Left the station a mess."],
}
EDIT_REASONS = ["Forgot to clock out; confirmed with the captain", "Clocked in at the wrong shift", "Phone died, time from the sign-in sheet"]
DROP_REASONS = ["Sick", "Family emergency", "Car trouble", "Double-booked with my other job", "Childcare fell through"]
CHAT = ["Heads up: load-in door code changed, ask the captain.", "Can anyone bring an extra wine key?", "Parking is validated tonight.",
        "Running five minutes behind, on the train now.", "Family meal is tacos today.", "Please confirm you read the update about the start time."]
BIOS = ["Five years in hospitality, happiest on a busy floor.", "Weekend warrior; weekdays I'm in school.", "Events are my thing: weddings, galas, load-ins.",
        "Former restaurant manager picking up shifts.", "Reliable, early, and I bring my own tools.", "New to the city, looking for steady work."]


class Seeder:
    def __init__(self, db, args):
        self.db = db
        self.rng = random.Random(args.seed)
        self.now = datetime.now(UTC).replace(microsecond=0)
        self.weeks_back, self.weeks_ahead = args.weeks_back, args.weeks_ahead
        self.pw_hash = get_password_hash(args.password)
        self.extra_managers = args.manager_email or []
        self.names = set()
        self.busy = defaultdict(list)             # worker id -> [(start, end)]
        self.done = defaultdict(int)              # worker id -> completed shifts
        self.users = {}                           # id -> User
        self.profile = {}                         # id -> ace | solid | flaky | new
        self.counts = defaultdict(int)
        self.pending = []
        self.on_shift = defaultdict(set)          # shift id -> everyone with any request on it (one request per person)
        self.freelancers = []
        self.rated = defaultdict(list)            # worker id -> stars received

    # ---------------------------------------------------------------- small helpers
    def add(self, obj, kind=None):
        self.pending.append(obj)
        self.counts[kind or type(obj).__name__] += 1
        return obj

    async def flush(self):
        """Write what's been built so far, parents before children (the models have no relationships for
        SQLAlchemy to work the order out from, so go table by table in foreign-key order)."""
        order = {t.name: i for i, t in enumerate(Base.metadata.sorted_tables)}
        groups = defaultdict(list)
        for obj in self.pending:
            groups[order[obj.__tablename__]].append(obj)
        self.pending = []
        for i in sorted(groups):
            self.db.add_all(groups[i])
            await self.db.flush()

    def chance(self, p):
        return self.rng.random() < p

    def person(self, role="worker", first=None, last=None, email=None, tz="America/New_York", **extra):
        while first is None or (first, last) in self.names:
            first, last = self.rng.choice(FIRST), self.rng.choice(LAST)
        self.names.add((first, last))
        email = email or f"{first}.{last}@{DOMAIN}".lower()
        joined = self.now - timedelta(days=self.rng.randint(self.weeks_back * 7 + 10, self.weeks_back * 7 + 200))
        u = self.add(User(
            id=uid("user:" + email), email=email, hashed_password=self.pw_hash, role=role, first_name=first, last_name=last,
            phone=f"({self.rng.randint(201, 989)}) 555-01{self.rng.randint(0, 99):02d}", is_active=True,
            aggregate_rating=5.0, rating_count=0, total_shifts=0, skills=[], departments=[], discoverable="venues",
            created_at=joined, updated_at=joined, **extra))
        self.add(NotificationPreference(user_id=u.id, email_enabled=False, sms_enabled=False, push_enabled=True,
                                        reminders_enabled=True, new_shift_alerts="off", manager_alerts_email=False,
                                        timezone=tz), "prefs")
        self.users[u.id] = u
        return u

    def free(self, wid, start, end, shift=None):
        if shift is not None and wid in self.on_shift[shift.id]:
            return False
        return all(end + timedelta(hours=1) <= s or start - timedelta(hours=1) >= e for s, e in self.busy[wid])

    def log(self, venue, kind, text, when, actor=None, event=None, request=None, worker=None):
        self.add(VenueActivity(venue_id=venue.id, actor_user_id=actor, kind=kind, category=CATEGORY.get(kind, "changes"),
                               summary=text[:400], event_id=event, request_id=request, worker_id=worker, created_at=when),
                 "activity")

    # ---------------------------------------------------------------- venues, people
    def build_venue(self, spec):
        tz = ZoneInfo(spec["tz"])
        today = self.now.astimezone(tz).date()
        opened = self.now - timedelta(days=self.weeks_back * 7 + 30)
        s = dict(spec["settings"])
        if s.get("pay_period") == "biweekly":
            s["pay_period_anchor"] = today - timedelta(days=today.weekday() + 7 * (self.weeks_back + (self.weeks_back % 2)))
        venue = self.add(Venue(id=uid("venue:" + spec["key"]), name=spec["name"], description=spec["description"],
                               address=spec["address"], lat=spec["lat"], lng=spec["lng"], timezone=spec["tz"],
                               phone=spec["phone"], website_url=spec["website"], created_at=opened, updated_at=opened, **s))
        for i, (name, dept, rate, rmax, tips, pool, certs) in enumerate(spec["positions"]):
            self.add(VenuePosition(venue_id=venue.id, name=name, department=dept, default_rate=rate, default_rate_max=rmax,
                                   tips_eligible=tips, tip_pool=pool, required_certs=certs, sort_order=i,
                                   hide_rate=not s.get("show_rates_publicly", True), created_at=opened, updated_at=opened))
        locs = {}
        for name, addr, lat, lng, radius in spec.get("locations", []):
            loc = self.add(VenueLocation(id=uuid.uuid4(), venue_id=venue.id, name=name, address=addr, lat=lat, lng=lng,
                                         radius_meters=radius, created_at=opened, updated_at=opened))
            locs[name] = loc

        first, last = spec["manager"]
        mgr = self.person("venue_manager", first, last, f"manager.{spec['key']}@{DOMAIN}", spec["tz"],
                          bio=f"General manager, {spec['name']}.")
        self.add(VenueManager(venue_id=venue.id, user_id=mgr.id, is_primary=True, created_at=opened))

        pos = {p[0]: p for p in spec["positions"]}
        members, by_role = {}, defaultdict(list)
        for n, roles, company, override in spec["roster"]:
            for _ in range(n):
                w = self.person(tz=spec["tz"], bio=self.rng.choice(BIOS),
                                emergency_contact_name=f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)}",
                                emergency_contact_phone=f"({self.rng.randint(201, 989)}) 555-01{self.rng.randint(0, 99):02d}")
                w.skills = list(roles)
                w.departments = sorted({pos[r][1] for r in roles})
                self.profile[w.id] = self.rng.choices(["ace", "solid", "flaky"], [60, 28, 12])[0]
                m = self.add(VenueWhitelist(
                    venue_id=venue.id, worker_id=w.id, status="active", is_active=True, positions=list(roles),
                    source=self.rng.choice(["manager", "invite", "import"]), works_through=company, time_tracking=override,
                    added_by_user_id=mgr.id, created_at=w.created_at, updated_at=w.created_at,
                    notes=self.rng.choice([None, None, None, "Great with VIPs.", "Prefers weekends.", "Forklift certified."])))
                members[w.id] = m
                for r in roles:
                    by_role[r].append(w)
                self.certs_for(w, roles, pos, venue, mgr)
                self.availability_for(w)
        return dict(spec=spec, venue=venue, tz=tz, today=today, mgr=mgr, pos=pos, members=members, by_role=by_role,
                    locs=locs, events=[], future=[])

    def certs_for(self, w, roles, pos, venue, mgr):
        need = sorted({c for r in roles for c in pos[r][6]})
        today = self.now.date()
        for c in need:
            roll = self.rng.random()
            if roll < 0.78:
                status, exp = "verified", today + timedelta(days=self.rng.randint(90, 600))
            elif roll < 0.88:
                status, exp = "unverified", today + timedelta(days=self.rng.randint(120, 500))     # waiting for a manager
            elif roll < 0.95:
                status, exp = "verified", today + timedelta(days=self.rng.randint(4, 20))          # expiring soon
            else:
                status, exp = "verified", today - timedelta(days=self.rng.randint(5, 40))          # expired
            if c == "age_21":
                exp = None
            self.add(WorkerCertification(
                worker_id=w.id, cert_type=c, number=f"{c[:2].upper()}-{self.rng.randint(100000, 999999)}",
                issued_on=today - timedelta(days=self.rng.randint(200, 700)), expires_on=exp, status=status,
                verified_by_user_id=mgr.id if status == "verified" else None,
                verified_venue_id=venue.id if status == "verified" else None,
                verified_at=(self.now - timedelta(days=self.rng.randint(20, 120))) if status == "verified" else None), "certs")

    def availability_for(self, w):
        if self.chance(0.25):
            return                                                   # some people never fill it in
        for wd in sorted(self.rng.sample(range(7), self.rng.randint(3, 6))):
            a, b = self.rng.choice([("07:00", "16:00"), ("10:00", "20:00"), ("15:00", "23:30"), ("06:00", "23:30")])
            self.add(WorkerAvailability(worker_id=w.id, weekday=wd, start_local=a, end_local=b), "availability")

    # ---------------------------------------------------------------- events
    def make_event(self, v, title, start, end, positions, location=None, status="published", notes=None):
        venue, mgr = v["venue"], v["mgr"]
        posted = min(start - timedelta(days=self.rng.randint(6, 16)),
                     self.now - timedelta(hours=self.rng.randint(3, 240)))
        ev = self.add(ShiftEvent(
            id=uuid.uuid4(), venue_id=venue.id, created_by_user_id=mgr.id, title=title, start_time=start, end_time=end,
            notes=notes, location_id=v["locs"][location].id if location else None,
            geofence_mode="venue_default", status=status, published_at=None if status == "draft" else posted,
            created_at=posted, updated_at=posted))
        shifts = []
        for role, cap in positions:
            p = v["pos"][role]
            shifts.append(self.add(Shift(
                id=uuid.uuid4(), venue_id=venue.id, event_id=ev.id, created_by_user_id=mgr.id, title=title, role_type=role,
                start_time=start, end_time=end, hourly_rate=p[2], hourly_rate_max=p[3],
                hide_rate=not venue.show_rates_publicly, tips_eligible=p[4], tip_pool=p[5], capacity=cap, spots_filled=0,
                approval_mode="venue_default", is_shift_auto_confirm=False,
                status="DRAFT" if status == "draft" else "OPEN", created_at=posted, updated_at=posted)))
        if status != "draft":
            self.log(venue, "event_created", f"Posted {title} ({short_when(start, venue)})", posted, mgr.id, ev.id)
        rec = dict(event=ev, shifts=shifts, bookings=[], start=start, end=end)
        v["events"].append(rec)
        return rec

    def candidates(self, v, role, start, end, outsiders=0.0, shift=None):
        team = [w for w in v["by_role"].get(role, []) if self.free(w.id, start, end, shift)]
        self.rng.shuffle(team)
        team.sort(key=lambda w: 1 if v["members"][w.id].works_through else 0)      # house staff first, overhire fills in
        if outsiders and self.chance(outsiders):
            extra = [f for f in self.freelancers if role in (f.skills or []) and self.free(f.id, start, end, shift)]
            self.rng.shuffle(extra)
            team = extra[:1] + team
        return team

    def book(self, v, shift, w, status="approved", source=None, when=None, **extra):
        venue = v["venue"]
        member = v["members"].get(w.id)
        when = when or min(shift.start_time - timedelta(days=self.rng.randint(2, 9), hours=self.rng.randint(0, 20)),
                           self.now - timedelta(hours=self.rng.randint(2, 70)))
        when = max(when, shift.created_at + timedelta(minutes=self.rng.randint(5, 180)))     # never before it was posted
        when = min(when, self.now - timedelta(minutes=5))
        if source is None:
            if member is None:
                source = "venue_everyone_auto" if venue.approval_policy == "everyone_auto" else "manager_manual"
            else:
                source = {"team_auto": "venue_whitelist", "everyone_auto": "venue_everyone_auto"}.get(
                    venue.approval_policy, "manager_manual")
                if self.chance(0.15):
                    source = "manager_assign"
        booked = status in ("approved", "confirmed", "checked_in", "completed", "no_show")
        req = self.add(ShiftRequest(
            id=uuid.uuid4(), shift_id=shift.id, worker_id=w.id, status=status, approval_source=source if booked else "worker_application",
            approved_by_user_id=v["mgr"].id if booked and source.startswith("manager") else None,
            approved_at=when if booked else None, created_at=when, updated_at=when, **extra))
        self.on_shift[shift.id].add(w.id)
        if status in ("approved", "confirmed", "checked_in", "completed"):
            if self.chance(0.8):                                   # most people have opened the shift's notes
                req.info_seen_at = min(when + timedelta(minutes=self.rng.randint(1, 600)), self.now - timedelta(minutes=1))
            shift.spots_filled = (shift.spots_filled or 0) + 1
            if shift.spots_filled >= shift.capacity:
                shift.status = "FILLED"
            self.busy[w.id].append((shift.start_time, shift.end_time))
        return req

    def geo(self, venue, late_out=False):
        if not venue.geofence_enabled:
            return dict(clock_in_geo_status="not_checked")
        if self.chance(0.05):
            d = venue.geofence_radius_meters + self.rng.randint(15, venue.geofence_buffer_meters - 10)
            return dict(clock_in_geo_status="outside_geofence", clock_in_distance_m=d,
                        clock_in_lat=venue.lat + d / 111000.0, clock_in_lng=venue.lng)
        d = self.rng.randint(4, max(10, venue.geofence_radius_meters - 30))
        return dict(clock_in_geo_status="on_site", clock_in_distance_m=d, clock_in_lat=venue.lat + d / 111000.0,
                    clock_in_lng=venue.lng, clock_out_geo_status="on_site", clock_out_distance_m=self.rng.randint(4, 80))

    def work(self, v, shift, req, w, start, end):
        """A finished booking: clock-in / clock-out (or nothing, for people on venue payroll)."""
        venue, prof = v["venue"], self.profile.get(w.id, "solid")
        mode = resolve(venue.team_time_tracking, v["members"].get(w.id))
        req.time_tracking = mode
        req.info_seen_at = start - timedelta(hours=self.rng.randint(2, 40))
        p_noshow = {"ace": 0.0, "solid": 0.012, "flaky": 0.09}[prof]
        if self.chance(p_noshow):
            req.status, req.status_reason = "no_show", self.rng.choice(["No call, no show", "Didn't arrive; texted after doors"])
            shift.spots_filled = max(0, shift.spots_filled - 1)
            self.add(TimeEntryEdit(shift_request_id=req.id, editor_id=v["mgr"].id, action="no_show", old_value="approved",
                                   new_value=NO_SHOW_RELEASED, reason=req.status_reason, created_at=start + timedelta(minutes=50)), "edits")
            self.log(venue, "no_show", f"{w.first_name} {w.last_name} was marked a no-show for {shift.role_type} · {shift.title}",
                     start + timedelta(minutes=50), v["mgr"].id, shift.event_id, req.id, w.id)
            return
        self.done[w.id] += 1
        if mode == PAYROLL:
            return                                                   # the venue's own time clock has their hours
        late = self.chance({"ace": 0.03, "solid": 0.13, "flaky": 0.32}[prof])
        cin = start + timedelta(minutes=self.rng.randint(12, 38) if late else self.rng.randint(-12, 4))
        cout = end + timedelta(minutes=self.rng.randint(-6, 24))
        g = self.geo(venue)
        auto = self.chance(0.04)
        if auto:
            cout = end
            g.update(clock_out_geo_status="auto", clock_out_distance_m=None)
        entry = self.add(TimeEntry(id=uuid.uuid4(), worker_id=w.id, shift_id=shift.id, clock_in_time=cin,
                                   clock_out_time=cout, auto_closed=auto, **g))
        req.status, req.check_in_time, req.check_out_time, req.check_in_verified = "completed", cin, cout, True
        if self.chance(0.045):
            old = fmt_range(cin, cout)
            entry.clock_out_time = cout = end + timedelta(minutes=self.rng.choice([0, 15, 30]))
            req.check_out_time = cout
            self.add(TimeEntryEdit(shift_request_id=req.id, time_entry_id=entry.id, editor_id=v["mgr"].id, action="edit",
                                   old_value=old, new_value=fmt_range(cin, cout), reason=self.rng.choice(EDIT_REASONS),
                                   created_at=end + timedelta(hours=self.rng.randint(10, 30))), "edits")
        if shift.hourly_rate_max is not None and self.chance(0.3):
            req.pay_rate = float(shift.hourly_rate_max)

    def past_event(self, v, title, start, end, positions, location=None):
        venue = v["venue"]
        rec = self.make_event(v, title, start, end, positions, location)
        for shift in rec["shifts"]:
            want = shift.capacity if self.chance(0.88) else max(1, shift.capacity - 1)
            pool = self.candidates(v, shift.role_type, start, end, outsiders=0.12, shift=shift)
            for w in pool:
                if shift.spots_filled >= want:
                    break
                prof = self.profile.get(w.id, "solid")
                if self.chance({"ace": 0.005, "solid": 0.02, "flaky": 0.07}[prof]):      # booked, then dropped
                    hours_before = self.rng.choice([6, 20, 40, 60, 100, 200])
                    drop_at = start - timedelta(hours=hours_before)
                    self.on_shift[shift.id].add(w.id)
                    self.add(ShiftRequest(id=uuid.uuid4(), shift_id=shift.id, worker_id=w.id, status="dropped",
                                          approval_source="venue_whitelist", approved_at=drop_at - timedelta(days=3),
                                          dropped_at=drop_at, status_reason=self.rng.choice(DROP_REASONS),
                                          created_at=drop_at - timedelta(days=3), updated_at=drop_at), "ShiftRequest")
                    self.log(venue, "shift_dropped", f"{w.first_name} {w.last_name} dropped {shift.role_type} · {title}",
                             drop_at, w.id, rec["event"].id, None, w.id)
                    continue
                req = self.book(v, shift, w)
                self.work(v, shift, req, w, start, end)
                rec["bookings"].append((req, shift, w))
        self.tips_and_ratings(v, rec)
        return rec

    def tips_and_ratings(self, v, rec):
        venue, mgr, end = v["venue"], v["mgr"], rec["end"]
        worked = [(r, s, w) for r, s, w in rec["bookings"] if r.status in ("completed", "approved")]
        if venue.tips_enabled and any(s.tips_eligible for s in rec["shifts"]) and self.chance(0.88):
            poolers = [b for b in worked if b[1].tip_pool]
            pool = 0
            if poolers:
                pool = len(poolers) * self.rng.randint(35, 130) + self.rng.choice([0, 0.25, 0.5])
                self.add(EventTip(event_id=rec["event"].id, venue_id=venue.id, pool_amount=pool, split=venue.tip_pool_split,
                                  note=self.rng.choice([None, None, "Card tips from the POS", "Includes the host's envelope"]),
                                  updated_by_user_id=mgr.id, created_at=end + timedelta(hours=11), updated_at=end + timedelta(hours=11)))
            own = 0
            for r, s, _w in worked:
                if s.tips_eligible and not s.tip_pool:
                    r.tip_amount = self.rng.randint(18, 95) + self.rng.choice([0, 0.5])
                    own += r.tip_amount
            if pool or own:
                self.log(venue, "tips_updated", f"Tips for {rec['event'].title} ({short_when(rec['start'], venue)}) · pool "
                         f"${pool:,.2f}, own tips ${own:,.2f}", end + timedelta(hours=11), mgr.id, rec["event"].id)
        for r, _s, w in worked:
            if r.status == "completed" and self.chance(0.42):
                prof = self.profile.get(w.id, "solid")
                stars = self.rng.choices([5, 4, 3, 2], {"ace": [78, 20, 2, 0], "solid": [40, 45, 13, 2], "flaky": [10, 35, 35, 20]}[prof])[0]
                self.add(Rating(shift_request_id=r.id, venue_id=venue.id, worker_id=w.id, rated_by_user_id=mgr.id, rating=stars,
                                review=self.rng.choice(REVIEWS[stars]), would_book_again=stars >= 4,
                                created_at=end + timedelta(hours=self.rng.randint(12, 60)),
                                updated_at=end + timedelta(hours=60)), "ratings")
                self.rated[w.id].append(stars)

    def local(self, v, d: date, hhmm: str):
        h, m = map(int, hhmm.split(":"))
        return datetime.combine(d, time(h, m), tzinfo=v["tz"]).astimezone(UTC)

    def history(self, v):
        spec, today = v["spec"], v["today"]
        monday = today - timedelta(days=today.weekday())
        for wk in range(self.weeks_back, -1, -1):
            for title, wd, hhmm, hours, positions, prob, loc in spec["patterns"]:
                d = monday - timedelta(days=7 * wk) + timedelta(days=wd)
                if d >= today or not self.chance(prob):
                    continue
                start = self.local(v, d, hhmm)
                end = start + timedelta(hours=hours)
                if end > self.now - timedelta(hours=9):
                    continue                                          # too close to now; today is built separately
                self.past_event(v, title, start, end, positions, loc)
            bw = spec.get("busy_week")
            if bw and wk == bw["weeks_ago"]:                           # a full week of long days: weekly overtime
                crew = None
                for wd in range(5):
                    d = monday - timedelta(days=7 * wk) + timedelta(days=wd)
                    start = self.local(v, d, bw["start"])
                    rec = self.make_event(v, f"{bw['title']} (day {wd + 1})", start, start + timedelta(hours=bw["hours"]), bw["positions"])
                    if crew is None:
                        crew = {s.role_type: self.candidates(v, s.role_type, start - timedelta(days=1), start + timedelta(days=6))[:s.capacity]
                                for s in rec["shifts"]}
                    for s in rec["shifts"]:
                        for w in crew[s.role_type]:
                            if self.free(w.id, s.start_time, s.end_time):
                                req = self.book(v, s, w)
                                self.work(v, s, req, w, s.start_time, s.end_time)
                                rec["bookings"].append((req, s, w))
                    self.tips_and_ratings(v, rec)
        # one cancelled event in the past
        d = today - timedelta(days=self.rng.randint(9, 16))
        title, _wd, hhmm, hours, positions, _p, _l = spec["patterns"][0]
        start = self.local(v, d, "11:00")
        rec = self.make_event(v, f"{title} (private buyout)", start, start + timedelta(hours=4), positions[:2])
        when = start - timedelta(days=2)
        rec["event"].cancelled_at, rec["event"].cancel_reason = when, "Client postponed"
        for s in rec["shifts"]:
            s.status, s.cancelled_at, s.cancel_reason = "CANCELLED", when, "Client postponed"
        self.log(v["venue"], "event_cancelled", f"Cancelled {rec['event'].title} ({short_when(start, v['venue'])}) · Client postponed",
                 when, v["mgr"].id, rec["event"].id)

    # ---------------------------------------------------------------- today
    def today(self, v):
        venue, spec, now = v["venue"], v["spec"], self.now
        base = spec["patterns"][0][4]
        # ended a couple of hours ago: hours are in, tips aren't entered yet
        start, end = now - timedelta(hours=7), now - timedelta(hours=2)
        rec = self.make_event(v, "Private Luncheon", start, end, base[:3])
        for s in rec["shifts"]:
            for w in self.candidates(v, s.role_type, start, end)[:s.capacity]:
                req = self.book(v, s, w)
                self.work(v, s, req, w, start, end)
        # live right now
        start, end = now - timedelta(minutes=75), now + timedelta(hours=3, minutes=15)
        rec = self.make_event(v, "Private Event (in progress)", start, end, base, notes="Client is VIP. Service starts on the hour.")
        first_clocker = True
        for s in rec["shifts"]:
            pool = self.candidates(v, s.role_type, start, end)
            for i, w in enumerate(pool[:max(1, s.capacity - (1 if s.capacity > 2 else 0))]):
                req = self.book(v, s, w)
                mode = resolve(venue.team_time_tracking, v["members"].get(w.id))
                req.time_tracking = mode
                req.info_seen_at = start - timedelta(hours=3)
                if mode == PAYROLL:
                    continue
                if first_clocker:                                    # one person is late and hasn't clocked in
                    first_clocker = False
                    continue
                cin = start + timedelta(minutes=self.rng.choice([-9, -4, 0, 2, 22]))
                self.add(TimeEntry(id=uuid.uuid4(), worker_id=w.id, shift_id=s.id, clock_in_time=cin, **self.geo(venue)))
                req.status, req.check_in_time, req.check_in_verified = "checked_in", cin, True
            self.add(ShiftBoardMessage(shift_id=s.id, author_id=v["mgr"].id, content=self.rng.choice(CHAT),
                                       created_at=start - timedelta(hours=2)), "messages")
        # later today: there's an update not everyone has read
        start, end = now + timedelta(hours=3), now + timedelta(hours=8)
        rec = self.make_event(v, "Evening Reception", start, end, base)
        rec["event"].info_updated_at, rec["event"].info_change = now - timedelta(hours=2), "Start time moved 30 minutes earlier"
        for s in rec["shifts"]:
            s.info_updated_at, s.info_change = now - timedelta(hours=2), "Start time moved 30 minutes earlier"
            for w in self.candidates(v, s.role_type, start, end)[:s.capacity]:
                req = self.book(v, s, w)
                req.info_seen_at = (now - timedelta(minutes=self.rng.randint(5, 100))) if self.chance(0.6) else now - timedelta(days=2)
        v["future"].append(rec)

    # ---------------------------------------------------------------- upcoming
    def upcoming(self, v):
        spec, today, venue, mgr = v["spec"], v["today"], v["venue"], v["mgr"]
        monday = today - timedelta(days=today.weekday())
        for wk in range(0, self.weeks_ahead + 1):
            fill = [0.9, 0.7, 0.45, 0.2, 0.1][min(wk, 4)]
            for title, wd, hhmm, hours, positions, prob, loc in spec["patterns"]:
                d = monday + timedelta(days=7 * wk + wd)
                if d <= today or not self.chance(min(1.0, prob + 0.1)):
                    continue
                start = self.local(v, d, hhmm)
                rec = self.make_event(v, title, start, start + timedelta(hours=hours), positions, loc)
                for s in rec["shifts"]:
                    for w in self.candidates(v, s.role_type, s.start_time, s.end_time, shift=s):
                        if s.spots_filled >= s.capacity or not self.chance(fill):
                            continue
                        req = self.book(v, s, w)
                        rec["bookings"].append((req, s, w))
                v["future"].append(rec)
        fut = sorted([r for r in v["future"] if r["start"] > self.now + timedelta(hours=20)], key=lambda r: r["start"])
        if not fut:
            return
        now = self.now

        # one upcoming event was cancelled yesterday (done first, so nothing below lands on it)
        if len(fut) > 6:
            rec = fut.pop(5)
            when = now - timedelta(hours=20)
            rec["event"].cancelled_at, rec["event"].cancel_reason = when, "Venue maintenance"
            for s in rec["shifts"]:
                s.status, s.cancelled_at, s.cancel_reason, s.spots_filled = "CANCELLED", when, "Venue maintenance", 0
            for r, s, w in rec["bookings"]:
                r.status, r.status_reason = "cancelled", "Event cancelled: Venue maintenance"
                self.busy[w.id] = [b for b in self.busy[w.id] if b != (s.start_time, s.end_time)]
            self.log(venue, "event_cancelled", f"Cancelled {rec['event'].title} ({short_when(rec['start'], venue)}) · Venue maintenance",
                     when, mgr.id, rec["event"].id)

        def open_shift(rec):
            return next((s for s in rec["shifts"] if s.spots_filled < s.capacity), None)

        # requests waiting for the manager (team members at "I approve everyone" venues, outsiders elsewhere)
        for rec in fut[:6]:
            s = open_shift(rec)
            if s is None:
                continue
            askers = [f for f in self.freelancers if s.role_type in (f.skills or []) and self.free(f.id, s.start_time, s.end_time, s)]
            if venue.approval_policy == "manual":
                askers = self.candidates(v, s.role_type, s.start_time, s.end_time, shift=s)[:2] + askers[:1]
            if venue.approval_policy == "everyone_auto":
                for f in askers[:1]:
                    self.book(v, s, f, source="venue_everyone_auto")
                continue
            for w in askers[:2]:
                when = now - timedelta(hours=self.rng.randint(1, 40))
                req = self.book(v, s, w, status="pending_manager_approval", when=when,
                                notes=self.rng.choice([None, "I've worked this room before.", "Available for the full shift.", "Can stay late if needed."]))
                self.log(venue, "request_created", f"{w.first_name} {w.last_name} asked for {s.role_type} · {rec['event'].title} "
                         f"({short_when(rec['start'], venue)})", when, w.id, rec["event"].id, req.id, w.id)

        # offers out to three people for an open spot
        rec = fut[min(1, len(fut) - 1)]
        s = open_shift(rec)
        if s is not None:
            batch, when = uuid.uuid4(), now - timedelta(hours=5)
            people = self.candidates(v, s.role_type, s.start_time, s.end_time, shift=s)[:3]
            for w in people:
                self.add(ShiftOffer(shift_id=s.id, venue_id=venue.id, worker_id=w.id, batch_id=batch, offered_by_user_id=mgr.id,
                                    status="pending", message="Could really use you on this one.", expires_at=s.start_time,
                                    created_at=when), "offers")
            if people:
                self.log(venue, "offers_sent", f"Offered {s.role_type} · {rec['event'].title} ({short_when(rec['start'], venue)}) "
                         f"to {len(people)} people", when, mgr.id, rec["event"].id)

        # a full shift with a waitlist
        rec = fut[0]
        s = max(rec["shifts"], key=lambda x: x.capacity)
        for w in self.candidates(v, s.role_type, s.start_time, s.end_time, shift=s):
            if s.spots_filled >= s.capacity:
                break
            rec["bookings"].append((self.book(v, s, w), s, w))
        if s.spots_filled >= s.capacity:
            waiting = [w for w in v["by_role"][s.role_type] + self.freelancers
                       if s.role_type in (w.skills or []) and self.free(w.id, s.start_time, s.end_time, s)][:3]
            for i, w in enumerate(waiting):
                when = now - timedelta(hours=30 - i * 6)
                self.add(WaitlistEntry(shift_id=s.id, venue_id=venue.id, event_id=rec["event"].id, worker_id=w.id,
                                       auto_book=i != 1, status="waiting", created_at=when, updated_at=when), "waitlist")

        # cover requests: one open to the team, one on the public board, one waiting for the manager
        booked = [(r, sh, w) for rec in fut[:8] for r, sh, w in rec["bookings"] if r.status == "approved" and w.id in v["members"]]
        self.rng.shuffle(booked)
        kinds = ["team", "public" if venue.allow_public_cover else "team", "pending"]
        for (req, sh, w), kind in zip(booked[:3], kinds):
            when = now - timedelta(hours=self.rng.randint(2, 30))
            cover = self.add(CoverRequest(id=uuid.uuid4(), shift_id=sh.id, venue_id=venue.id, request_id=req.id, from_worker_id=w.id,
                                          audience="public" if kind == "public" else "team", status="open",
                                          note=self.rng.choice(["Family thing came up", "Exam the next morning", "Out of town that day"]),
                                          created_at=when, updated_at=when), "cover")
            self.log(venue, "cover_requested", f"{w.first_name} {w.last_name} asked for cover: {sh.role_type} · {sh.title} "
                     f"({short_when(sh.start_time, venue)})", when, w.id, sh.event_id, req.id, w.id)
            if kind == "pending":
                taker = next((f for f in self.freelancers if sh.role_type in (f.skills or []) and self.free(f.id, sh.start_time, sh.end_time, sh)), None)
                if taker is None:
                    continue
                tr = self.add(ShiftTransfer(id=uuid.uuid4(), shift_id=sh.id, from_worker_id=w.id, to_worker_id=taker.id,
                                            status="pending_manager_approval", notes=f"Cover request: {cover.note}",
                                            cover_request_id=cover.id, created_at=when + timedelta(hours=1),
                                            updated_at=when + timedelta(hours=1)), "transfers")
                cover.status, cover.taken_by_worker_id, cover.transfer_id = "pending_approval", taker.id, tr.id

        # hand-offs between teammates: one waiting on the teammate, one waiting on the manager
        for (req, sh, w), status in zip(booked[3:5], ["pending_worker_acceptance", "pending_manager_approval"]):
            mate = next((m for m in self.candidates(v, sh.role_type, sh.start_time, sh.end_time, shift=sh) if m.id != w.id), None)
            if mate is not None:
                when = now - timedelta(hours=self.rng.randint(3, 20))
                self.add(ShiftTransfer(shift_id=sh.id, from_worker_id=w.id, to_worker_id=mate.id, status=status,
                                       notes="Can you take this one? I'll owe you.", created_at=when, updated_at=when), "transfers")

        # a draft, a cancelled event, templates, invites, team chat
        title, _wd, hhmm, hours, positions, _p, _l = spec["patterns"][-1]
        start = self.local(v, today + timedelta(days=7 * self.weeks_ahead + 5), hhmm)
        self.make_event(v, f"{title} (holiday special)", start, start + timedelta(hours=hours), positions, status="draft")
        for title, _wd, hhmm, hours, positions, _p, loc in spec["patterns"][:2]:
            h, m = map(int, hhmm.split(":"))
            endm = int(h * 60 + m + hours * 60) % (24 * 60)
            self.add(EventTemplate(venue_id=venue.id, created_by_user_id=mgr.id, name=f"{title} (standard crew)", title=title,
                                   start_local=hhmm, end_local=f"{endm // 60:02d}:{endm % 60:02d}",
                                   location_id=v["locs"][loc].id if loc else None, geofence_mode="venue_default",
                                   positions=[dict(role_type=r, capacity=c, hourly_rate=float(v["pos"][r][2]),
                                                   hourly_rate_max=v["pos"][r][3], hide_rate=False, tips_eligible=v["pos"][r][4],
                                                   tip_pool=v["pos"][r][5], role_notes=None, staff_notes=None,
                                                   approval_mode="venue_default") for r, c in positions]), "templates")
        for i in range(2):
            fn, ln = self.rng.choice(FIRST), self.rng.choice(LAST)
            when = now - timedelta(days=i * 3 + 1)
            self.add(VenueInvite(venue_id=venue.id, token=secrets.token_urlsafe(24), kind="personal",
                                 email=f"{fn}.{ln}.invited@{DOMAIN}".lower(), first_name=fn, last_name=ln,
                                 positions=[spec["positions"][i][0]], created_by_user_id=mgr.id,
                                 expires_at=now + timedelta(days=14), last_sent_at=when, created_at=when), "invites")
        for rec in fut[:3]:
            for r, s, w in rec["bookings"][:2]:
                self.add(ShiftBoardMessage(shift_id=s.id, author_id=w.id, content=self.rng.choice(CHAT),
                                           created_at=now - timedelta(hours=self.rng.randint(1, 30))), "messages")
        # time off: a few people are away soon (one of them is booked that day, which shows the warning)
        people = list(v["members"])
        self.rng.shuffle(people)
        for wid in people[:3]:
            d = today + timedelta(days=self.rng.randint(2, 14))
            self.add(TimeOffBlock(worker_id=wid, all_day=True, start_date=d, end_date=d + timedelta(days=self.rng.randint(0, 3)),
                                  repeat="none", weekdays=[], reason=self.rng.choice(["Vacation", "Family visit", "Appointment"])), "time off")
        if booked:
            req, sh, w = booked[-1]
            d = sh.start_time.astimezone(v["tz"]).date()
            self.add(TimeOffBlock(worker_id=w.id, all_day=True, start_date=d, end_date=d, repeat="none", weekdays=[],
                                  reason="Doctor's appointment"), "time off")

    # ---------------------------------------------------------------- after the main write
    async def approvals(self, v):
        """Approve (lock) the older finished pay periods; leave the latest finished one ready to approve."""
        venue, mgr = v["venue"], v["mgr"]
        if not venue.pay_period_approval:
            return
        periods = pp.recent_periods(venue, v["today"], 40)
        oldest = (self.now - timedelta(days=self.weeks_back * 7 + 7)).date()
        done = 0
        for s, e in periods[2:]:
            if e < oldest:
                break
            data = await pp.summarize(self.db, venue, s, e, people=False)
            if not data["people"] and not data["payroll_shifts"]:
                continue
            when = datetime.combine(e + timedelta(days=2), time(10, 15), tzinfo=v["tz"]).astimezone(UTC)
            totals = dict(people=data["people"], total_hours=data["total_hours"], overtime_hours=data["overtime_hours"],
                          total_pay=data["total_pay"], total_tips=data["total_tips"])
            if done == 1:                                               # this one was reopened once to fix a time
                self.add(PayPeriodApproval(venue_id=venue.id, start_date=s, end_date=e, status="reopened", approved_by_user_id=mgr.id,
                                           approved_at=when, reopened_by_user_id=mgr.id, reopened_at=when + timedelta(days=1),
                                           reopen_reason="A clock-out was wrong on Saturday", created_at=when, **totals), "approvals")
                self.log(venue, "pay_period_reopened", f"Reopened pay period {pp.period_label(s, e)}: “A clock-out was wrong on Saturday”",
                         when + timedelta(days=1), mgr.id)
                when += timedelta(days=1, hours=2)
            self.add(PayPeriodApproval(venue_id=venue.id, start_date=s, end_date=e, status="approved", approved_by_user_id=mgr.id,
                                       approved_at=when, created_at=when, **totals), "approvals")
            self.log(venue, "pay_period_approved", f"Approved and locked pay period {pp.period_label(s, e)} "
                     f"({data['total_hours']:g} h, ${data['total_pay']:,.2f})", when, mgr.id)
            done += 1

    async def run(self):
        built = [self.build_venue(spec) for spec in VENUES]
        # people who aren't on any team: they find shifts on the public board
        roles = sorted({p[0] for spec in VENUES for p in spec["positions"]})
        for _ in range(7):
            f = self.person(bio="Freelancer picking up shifts around town.")
            f.skills = self.rng.sample(roles, 4)
            f.discoverable = "everyone"
            self.profile[f.id] = self.rng.choice(["ace", "solid", "solid", "flaky"])
            self.freelancers.append(f)
        # one person who works at two venues, and a regional manager over two
        both = built[0]["by_role"]["Stagehand"][0]
        built[4]["members"][both.id] = self.add(VenueWhitelist(
            venue_id=built[4]["venue"].id, worker_id=both.id, status="active", is_active=True,
            positions=["Setup Crew", "Event Staff"], source="manager", works_through="Pro Staffing LLC",
            added_by_user_id=built[4]["mgr"].id))
        built[4]["by_role"]["Setup Crew"].append(both)
        regional = self.person("venue_manager", "Sam", "Whitaker", f"regional.manager@{DOMAIN}", bio="Regional operations manager.")
        # Phase 36: those two venues are one organization, and the regional manager owns it. An owner's
        # venue rows are via_org (the same rows services/organizations.sync_managers() would make).
        opened = self.now - timedelta(days=self.weeks_back * 7 + 30)
        org = self.add(Organization(id=ORG_IDS[0], name=ORG_NAME, created_at=opened, updated_at=opened))
        self.add(OrganizationMember(organization_id=org.id, user_id=regional.id, role="owner", venue_alerts=False,
                                    created_at=opened))
        for v in (built[1], built[2]):
            v["venue"].organization_id = org.id
            self.add(VenueManager(venue_id=v["venue"].id, user_id=regional.id, is_primary=False, via_org=True))
        # Phase 36: one shift lead per venue (a reliable team member), with an easy login
        for v in built:
            wid = next((w for w in v["members"] if self.profile.get(w) == "ace"), next(iter(v["members"])))
            v["members"][wid].is_lead = True
            self.users[wid].email = f"lead.{v['spec']['key']}@{DOMAIN}"
        # a brand-new team member with no history, and one removed, one blocked
        for v in built:
            newbie = self.person(tz=v["spec"]["tz"], bio="Just joined the team.")
            newbie.skills = [v["spec"]["positions"][0][0]]
            newbie.created_at = self.now - timedelta(days=2)
            self.profile[newbie.id] = "ace"
            self.add(VenueWhitelist(venue_id=v["venue"].id, worker_id=newbie.id, status="active", is_active=True,
                                    positions=list(newbie.skills), source="invite", created_at=self.now - timedelta(days=2),
                                    updated_at=self.now - timedelta(days=2)))
            for status, note in (("removed", "Moved out of state"), ("blocked", "Two no-shows in a row")):
                gone = self.person(tz=v["spec"]["tz"])
                gone.skills = [v["spec"]["positions"][0][0]]
                self.add(VenueWhitelist(venue_id=v["venue"].id, worker_id=gone.id, status=status, is_active=False,
                                        positions=list(gone.skills), source="manager", notes=note,
                                        added_by_user_id=v["mgr"].id))
        await self.flush()

        for v in built:
            self.history(v)
        for v in built:
            self.today(v)
        for v in built:
            self.upcoming(v)
        for wid, stars in self.rated.items():
            u = self.users[wid]
            u.rating_count, u.aggregate_rating = len(stars), round(sum(stars) / len(stars), 2)
        for wid, n in self.done.items():
            self.users[wid].total_shifts = n

        # existing accounts that should manage every demo venue (so testers can use their own logins)
        emails = [e.strip().lower() for e in self.extra_managers if e.strip()]
        for email in emails:
            u = await self.db.scalar(select(User).where(func.lower(User.email) == email))
            if u is None:
                print(f"  ! --manager-email {email}: no such account, skipped")
                continue
            if u.role == "worker":
                print(f"  ! --manager-email {email}: that's a worker account (managers and admins only), skipped")
                continue
            for v in built:
                self.add(VenueManager(venue_id=v["venue"].id, user_id=u.id, is_primary=False), "extra managers")
        await self.flush()
        for v in built:
            await self.approvals(v)
        await self.flush()
        return built


# ------------------------------------------------------------------------------------------------
# Commands
# ------------------------------------------------------------------------------------------------
VENUE_IDS = [uid("venue:" + s["key"]) for s in VENUES]


async def status(db):
    venues = (await db.execute(select(Venue.name).where(Venue.id.in_(VENUE_IDS)).order_by(Venue.name))).scalars().all()
    users = await db.scalar(select(func.count(User.id)).where(User.email.like(f"%@{DOMAIN}")))
    events = await db.scalar(select(func.count(ShiftEvent.id)).where(ShiftEvent.venue_id.in_(VENUE_IDS)))
    other_v = await db.scalar(select(func.count(Venue.id)).where(Venue.id.notin_(VENUE_IDS)))
    other_u = await db.scalar(select(func.count(User.id)).where(User.email.notlike(f"%@{DOMAIN}")))
    return dict(venues=venues, users=int(users or 0), events=int(events or 0), other_venues=int(other_v or 0),
                other_users=int(other_u or 0))


async def clear(db):
    """Delete the demo venues and demo accounts. Everything attached to them goes with them (ON DELETE CASCADE)."""
    v = (await db.execute(delete(Venue).where(Venue.id.in_(VENUE_IDS)))).rowcount
    await db.execute(delete(Organization).where(Organization.id.in_(ORG_IDS)))      # Phase 36: the demo organization
    u = (await db.execute(delete(User).where(User.email.like(f"%@{DOMAIN}")))).rowcount
    return v, u


def show(st):
    if st["venues"]:
        print(f"Demo data is loaded: {len(st['venues'])} venues ({', '.join(st['venues'])}), {st['users']} demo accounts, "
              f"{st['events']} events.")
    else:
        print("No demo data is loaded." + (f" ({st['users']} leftover demo accounts.)" if st["users"] else ""))
    print(f"Everything else in this database: {st['other_venues']} venue(s), {st['other_users']} account(s). "
          "The demo commands never touch those.")


async def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m src.demo_data", description="Load or remove ShiftUp demo data.")
    ap.add_argument("command", choices=["status", "load", "reset", "clear"])
    ap.add_argument("--weeks-back", type=int, default=8)
    ap.add_argument("--weeks-ahead", type=int, default=3)
    ap.add_argument("--seed", type=int, default=35)
    ap.add_argument("--password", default=DEFAULT_PASSWORD)
    ap.add_argument("--manager-email", action="append")
    args = ap.parse_args(argv)
    if not (1 <= args.weeks_back <= 26) or not (1 <= args.weeks_ahead <= 8):
        sys.exit("--weeks-back must be 1-26 and --weeks-ahead 1-8.")
    if len(args.password) < 8:
        sys.exit("--password must be at least 8 characters.")

    async with AsyncSessionLocal() as db:
        st = await status(db)
        if args.command == "status":
            show(st)
            return
        if args.command == "load" and (st["venues"] or st["users"]):
            show(st)
            sys.exit("Nothing changed. Use `reset` to replace the demo data, or `clear` to remove it.")
        try:
            if args.command in ("reset", "clear"):
                v, u = await clear(db)
                print(f"Removed {v} demo venue(s) and {u} demo account(s).")
            if args.command in ("load", "reset"):
                seeder = Seeder(db, args)
                built = await seeder.run()
                c = seeder.counts
                print(f"Loaded {len(built)} venues, {c['User']} accounts, {c['ShiftEvent']} events, {c['Shift']} shifts, "
                      f"{c['ShiftRequest']} bookings and requests, {c['TimeEntry']} clock-ins, {c['ratings']} ratings, "
                      f"{c['EventTip']} tip pools, {c['approvals']} pay-period approvals.")
            await db.commit()
        except Exception:
            await db.rollback()
            print("Failed. Nothing was changed.")
            raise
    if args.command in ("load", "reset"):
        print(f"\nEvery demo account's password is: {args.password}")
        print("Managers:")
        for s in VENUES:
            print(f"  manager.{s['key']}@{DOMAIN:<18}  {s['name']}")
        print(f"  regional.manager@{DOMAIN}   owner of {ORG_NAME} (Harbor House Events + Copperline Taproom)")
        print("Shift leads (worker accounts with a Lead view):")
        for s in VENUES:
            print(f"  lead.{s['key']}@{DOMAIN:<21}  {s['name']}")
        print(f"Workers: Admin -> Users, or any venue's Team list. They all end in @{DOMAIN}.")
        print("Existing admins see every demo venue in the venue picker.")


if __name__ == "__main__":
    asyncio.run(main())
