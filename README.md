## Realtime Chat App

A modern WhatsApp/Discord-style realtime chat application built with **Node.js**, **Express**, **Socket.IO**, **MongoDB (Mongoose)**, and a **vanilla HTML/CSS/JS** frontend.

Features:

- **Public chat** and **private DMs**
- **Online users list** with presence
- **Typing indicators**
- **Message history** (last 50 messages)
- **Timestamps**
- **Dark mode toggle**
- **Emoji picker (simple)**
- **Sound notifications**
- **Responsive, modern UI**

---

### Tech Stack

- **Backend**: Node.js, Express, Socket.IO, Mongoose, dotenv
- **Database**: MongoDB Atlas (or any MongoDB instance)
- **Frontend**: Vanilla HTML, CSS, JS

---

## Project Structure

```text
chat-app/
├── server/
│   ├── server.js
│   ├── config/
│   │   └── db.js
│   └── models/
│       └── Message.js
│
├── client/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── assets/
│       └── ping.mp3
│
├── .env
├── package.json
└── README.md
```

---

## Features

- **Realtime messaging** via Socket.IO
- **Multi-user support** with online user tracking
- **Public messages** to everyone
- **Private DMs** by clicking a user in the sidebar
- **Typing indicator** (`User is typing...`)
- **Message history**: last 50 messages loaded from MongoDB when joining
- **System messages** for join/leave
- **Timestamps** on every message
- **Dark mode** with local preference
- **Emoji picker** for quick reactions
- **Sound notification** on new incoming messages

---

## Prerequisites

- Node.js (LTS recommended)
- npm or yarn
- MongoDB instance (MongoDB Atlas or local)

---

## Installation

1. **Clone or copy the project**

   ```bash
   cd chat-app
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create `.env` file**

   The project already contains a sample `.env` file. Update it with your values:

   ```ini
   MONGO_URI=mongodb+srv://<username>:<password>@<cluster-url>/chat-app?retryWrites=true&w=majority
   PORT=5000
   ```

4. **Add notification sound (optional but recommended)**

   Replace the placeholder `client/assets/ping.mp3` with a real short notification sound file named `ping.mp3`.

---

## Running Locally

1. Ensure MongoDB is running (or MongoDB Atlas URI is reachable).

2. From the project root:

   ```bash
   npm start
   ```

3. Open the app in your browser:

   ```text
   http://localhost:5000
   ```

4. Open multiple browser windows/tabs to simulate multiple users.

---

## How It Works

- **Express server** exposes:
  - Static frontend (from `client/`)
  - `/health` endpoint for basic health checks

- **Socket.IO** handles:
  - `join` – register user, load last 50 messages, broadcast system join message
  - `chat_message` – handle public & private messages (DMs), persist to MongoDB
  - `typing` – emit typing indicator events (public or DM)
  - `disconnect` – broadcast system leave message and refresh online users

- **MongoDB (Mongoose)**:
  - `Message` model with fields: `user`, `text`, `to`, `timestamp`
  - Last 50 messages are loaded on join (sorted by `timestamp`)

---

## Deployment (Render / Railway / Similar)

### 1. MongoDB Atlas

1. Create a MongoDB Atlas cluster.
2. Create a database user with **username/password**.
3. Copy the connection string and update:

   ```ini
   MONGO_URI=mongodb+srv://<username>:<password>@<cluster-url>/chat-app?retryWrites=true&w=majority
   ```

### 2. Deploy to Render / Railway

The backend serves the frontend, so you only need a single web service:

- **Build command**: (none needed, leave empty)
- **Start command**:

  ```bash
  npm start
  ```

- **Environment variables**:
  - `MONGO_URI` – the MongoDB Atlas connection string
  - `PORT` – optional; Render/Railway usually provide this, and the app uses `process.env.PORT`

Make sure the service:

- Installs dependencies via `npm install`
- Uses `server/server.js` as the main entry (configured in `package.json`)

When deployed, open the Render/Railway URL and the app should be served directly.

---

## Environment Variables

Defined in `.env`:

- `MONGO_URI` – MongoDB connection URI
- `PORT` – Port to run the server on (defaults to `5000` if not set)

The server uses `dotenv` to load these values.

---

## Scripts

From `package.json`:

```json
{
  "scripts": {
    "start": "node server/server.js"
  }
}
```

Use:

```bash
npm start
```

---

## Screenshots

Add your screenshots here (for example, in a `screenshots/` folder) and link them:

- `![Public chat view](screenshots/public-chat.png)`
- `![Dark mode](screenshots/dark-mode.png)`

---

## Notes / Customization

- Update styles in `client/style.css` for branding tweaks.
- Adjust message history limit in `server/server.js` (currently 50).
- Enhance authentication by adding real user accounts (currently username-only).
- Swap the emoji set in `client/script.js` and `index.html` for your own.

---

## License

MIT

