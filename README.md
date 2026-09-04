# 💧 WaterMate

A shared water-duty tracker for roommates. Set a turn order once — the
app records who last brought water, when, with a photo, and automatically
hands the turn to the next person.

```
Create a group → add roommates → set turn order → current person
brings water → uploads a photo → system records who/date/time →
turn automatically moves to the next person.
```

## Tech stack

| Layer          | Technology                              |
|-----------------|------------------------------------------|
| Frontend        | HTML5, CSS3, vanilla JavaScript (no frameworks) |
| Backend         | Node.js, Express.js                      |
| Database        | PostgreSQL                               |
| ORM             | Prisma                                   |
| Authentication  | JWT (httpOnly cookie) + bcrypt password hashing |
| File uploads    | Multer (stored on disk under `backend/uploads/`) |

The Express server both serves the REST API **and** the static frontend,
so there's only one process to run.

## Requirements

- Node.js 18+
- PostgreSQL (running locally or reachable via a connection string)
- npm

## 1. Install dependencies

```bash
npm install
```

## 2. Set up the database

Create the database:

```bash
createdb watermate
```

Copy the example env file and fill in your own values:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/watermate"
JWT_SECRET="change-this-secret"
PORT=5000
```

Generate the Prisma client and run the migration to create tables:

```bash
npm run prisma:generate
npm run prisma:migrate
```

(`prisma:migrate` will prompt for a migration name the first time — `init`
works well.)

## 3. (Optional) Seed development/test data

```bash
npm run seed
```

This creates four users (Rohan, Aman, Sagar, Bibek — all with password
`password123`) and a "Sunrise Apartment" group with that turn order. It's
development/test data only; skip this step for a real deployment.

## 4. Run the app

```bash
npm run dev
```

Then open **http://localhost:5000** in your browser — this single URL
serves both the frontend pages and the `/api/...` backend routes.
Use `npm start` instead of `npm run dev` for a production-style run
without file-watching.

## Project structure

```
watermate/
├── frontend/           HTML5 + CSS3 + vanilla JS pages
│   ├── index.html       entry point, redirects based on auth state
│   ├── login.html / register.html
│   ├── group.html        create/join/switch groups
│   ├── dashboard.html    whose turn it is, stats, submit water
│   ├── members.html      turn order, admin reordering
│   ├── history.html      past deliveries
│   ├── css/
│   └── js/
├── backend/
│   ├── server.js
│   ├── routes/          Express route definitions
│   ├── controllers/     request handlers
│   ├── middleware/      auth, group-access, and upload middleware
│   ├── services/
│   │   └── turnService.js   all turn-rotation logic lives here
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── client.js     shared PrismaClient instance
│   │   └── seed.js
│   └── uploads/          uploaded water photos (gitignored)
├── .env.example
└── package.json
```

## How the turn rotation works

`backend/services/turnService.js` is the single source of truth for turn
logic, used by the water and member controllers:

- Each `GroupMember` row has a `turnOrder` (position in the rotation) and
  an `isCurrentTurn` flag. Exactly one member per group has the flag set.
- `completeTurn(groupId, userId, photoUrl)` runs inside a single database
  transaction: it verifies the user is the current-turn member, creates
  the `WaterRecord` with a **server-generated** timestamp, clears the
  current member's flag, and sets it on the next member in `turnOrder`
  (wrapping back to the first member after the last). The record is
  never saved without the turn advancing, and vice versa.
- The frontend never decides or sends whose turn it is — every check is
  re-verified server-side before a submission is accepted.

## API endpoints

### Auth
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
```

### Groups
```
POST   /api/groups                        create a group (creator auto-joins)
GET    /api/groups                        list your groups
POST   /api/groups/join                   join by invite code
GET    /api/groups/:groupId               group details
PUT    /api/groups/:groupId               rename (admin only)
```

### Members
```
GET    /api/groups/:groupId/members
PUT    /api/groups/:groupId/members/order      reorder turns (admin only)
DELETE /api/groups/:groupId/members/:memberId  remove a member (admin only)
```

### Water
```
POST   /api/groups/:groupId/water          submit water (multipart, field "photo")
GET    /api/groups/:groupId/water          paginated history, newest first
GET    /api/groups/:groupId/water/latest   most recent delivery
GET    /api/groups/:groupId/dashboard      turn status, stats, members, last delivery
```

All group/member/water routes require authentication and verify the
caller is a member of the group before returning any data.

## Security notes

- Passwords are hashed with bcrypt; plaintext passwords are never stored.
- Auth uses a JWT stored in an httpOnly cookie (also returned in the JSON
  body so it can be used as a Bearer token if you build another client).
- Every group/member/water route checks group membership before doing
  anything, so one group's data is never reachable via another group's ID.
- Only the group admin (creator) can reorder turns or remove members.
- Water submission is only accepted from the member whose turn it
  currently is — checked server-side, not trusted from the frontend.
- Uploaded photos are validated for MIME type (JPG/PNG/WebP) and size
  (5MB max) before being written to disk.
- Prisma parameterizes all queries, preventing SQL injection.

## Deploying to Vercel

1. **Create a Cloud PostgreSQL Database**:
   Vercel runs serverless functions and does not host a local database server. Set up a free cloud PostgreSQL database on [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres).

2. **Add Environment Variables in Vercel**:
   Go to your Vercel Project Dashboard → **Settings** → **Environment Variables**:
   - `DATABASE_URL`: Your hosted PostgreSQL connection URI (e.g. `postgresql://user:pass@ep-xyz.neon.tech/watermate?sslmode=require`)
   - `JWT_SECRET`: A long random secret string for JWT authentication

3. **Deploy**:
   When Vercel builds the project, it automatically runs Prisma migrations and generates the Prisma client. You can verify your connection at any time by visiting `https://your-domain.vercel.app/api/health`.
