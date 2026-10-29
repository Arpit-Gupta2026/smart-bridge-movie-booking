import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { readDb, writeDb, initializeDb, newId } from "./db.js";
import { authRequired, adminRequired } from "./middleware.js";
import { sendEmail } from "./mailer.js";

initializeDb();
const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
const tokenFor = u => jwt.sign({ id: u.id, role: u.role }, process.env.JWT_SECRET || "dev-only-change-me", { expiresIn: "7d" });
const notify = (db, userId, title, message, type = "info") => {
  db.notifications.unshift({ id: newId(), userId, title, message, type, read: false, createdAt: new Date().toISOString() });
};
const enrichShow = (db, show) => ({
  ...show, movie: db.movies.find(m => m.id === show.movieId),
  theater: db.theaters.find(t => t.id === show.theaterId),
  bookedSeats: db.seats.filter(s => s.showId === show.id && s.status === "booked").length
});
app.get("/api/health", (_, res) => res.json({ status: "ok", app: "Smart Bridge API" }));

// Authentication
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8)
    return res.status(400).json({ message: "Enter your name, a valid email, and a password of at least 8 characters." });
  const db = readDb();
  if (db.users.some(u => u.email.toLowerCase() === email.trim().toLowerCase()))
    return res.status(409).json({ message: "An account with this email already exists." });
  const user = { id: newId(), name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: "user", createdAt: new Date().toISOString() };
  db.users.push(user); notify(db, user.id, "Welcome to Smart Bridge", "Your account is ready. Find a movie and book your seats.");
  writeDb(db);
  res.status(201).json({ token: tokenFor(user), user: safeUser(user) });
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = readDb().users.find(u => u.email === String(email || "").trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) return res.status(401).json({ message: "Email or password is incorrect." });
  res.json({ token: tokenFor(user), user: safeUser(user) });
});
app.get("/api/auth/me", authRequired, (req, res) => {
  const user = readDb().users.find(u => u.id === req.user.id);
  res.json({ user: safeUser(user) });
});

// Movies
app.get("/api/movies", (req, res) => {
  const db = readDb(); let list = db.movies;
  const q = String(req.query.q || "").toLowerCase();
  const genre = String(req.query.genre || "");
  if (q) list = list.filter(m => `${m.title} ${m.genre} ${m.cast} ${m.language}`.toLowerCase().includes(q));
  if (genre && genre !== "All") list = list.filter(m => m.genre === genre);
  res.json(list);
});
app.get("/api/movies/:id", (req, res) => {
  const db = readDb(), movie = db.movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ message: "Movie not found." });
  res.json({ ...movie, shows: db.shows.filter(s => s.movieId === movie.id).map(s => enrichShow(db, s)), reviews: db.reviews.filter(r => r.movieId === movie.id).map(r => ({ ...r, user: db.users.find(u => u.id === r.userId)?.name || "Movie fan" })) });
});
app.post("/api/movies", authRequired, adminRequired, (req, res) => {
  const { title, genre, language, duration, rating, cast, releaseDate, description, poster } = req.body || {};
  if (!title || !genre || !language) return res.status(400).json({ message: "Title, genre and language are required." });
  const db = readDb();
  const movie = { id: newId(), title: String(title).trim(), genre, language, duration: Number(duration) || 120, rating: Number(rating) || 0, cast: cast || "Not announced", releaseDate: releaseDate || new Date().toISOString().slice(0,10), description: description || "", poster: poster || "", featured: false };
  db.movies.unshift(movie); writeDb(db); res.status(201).json(movie);
});
app.put("/api/movies/:id", authRequired, adminRequired, (req, res) => {
  const db = readDb(), movie = db.movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ message: "Movie not found." });
  Object.assign(movie, req.body, { id: movie.id }); writeDb(db); res.json(movie);
});
app.delete("/api/movies/:id", authRequired, adminRequired, (req, res) => {
  const db = readDb();
  if (db.shows.some(s => s.movieId === req.params.id && db.bookings.some(b => b.showId === s.id && b.status === "confirmed")))
    return res.status(409).json({ message: "Cannot delete a movie with confirmed bookings." });
  db.movies = db.movies.filter(m => m.id !== req.params.id); db.shows = db.shows.filter(s => s.movieId !== req.params.id); db.seats = db.seats.filter(s => db.shows.some(show => show.id === s.showId));
  writeDb(db); res.json({ message: "Movie deleted." });
});

// Theaters and shows
app.get("/api/theaters", (_, res) => res.json(readDb().theaters));
app.post("/api/theaters", authRequired, adminRequired, (req, res) => {
  const { name, location, screens } = req.body || {};
  if (!name || !location) return res.status(400).json({ message: "Theater name and location are required." });
  const db = readDb(), theater = { id: newId(), name, location, screens: Math.max(1, Number(screens) || 1) };
  db.theaters.push(theater); writeDb(db); res.status(201).json(theater);
});
app.put("/api/theaters/:id", authRequired, adminRequired, (req, res) => {
  const db = readDb(), theater = db.theaters.find(t => t.id === req.params.id);
  if (!theater) return res.status(404).json({ message: "Theater not found." });
  Object.assign(theater, req.body, { id: theater.id }); writeDb(db); res.json(theater);
});
app.get("/api/shows", (req, res) => {
  const db = readDb();
  let shows = db.shows.filter(s => new Date(s.startsAt) > new Date());
  if (req.query.movieId) shows = shows.filter(s => s.movieId === req.query.movieId);
  res.json(shows.map(s => enrichShow(db, s)).sort((a,b) => new Date(a.startsAt)-new Date(b.startsAt)));
});
app.post("/api/shows", authRequired, adminRequired, (req, res) => {
  const { movieId, theaterId, screen, startsAt, price, seatsTotal } = req.body || {};
  const db = readDb();
  if (!db.movies.some(m => m.id === movieId) || !db.theaters.some(t => t.id === theaterId) || !startsAt)
    return res.status(400).json({ message: "Choose an existing movie, theater, and show date/time." });
  const total = Math.min(200, Math.max(8, Number(seatsTotal) || 48));
  const show = { id: newId(), movieId, theaterId, screen: Math.max(1, Number(screen) || 1), startsAt: new Date(startsAt).toISOString(), price: Math.max(1, Number(price) || 200), seatsTotal: total, createdAt: new Date().toISOString() };
  db.shows.push(show);
  const rows = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i=0; i<total; i++) db.seats.push({ id: newId(), showId: show.id, seatNumber: `${rows[Math.floor(i/10)]}${(i%10)+1}`, status: "available", bookingId: null });
  writeDb(db); res.status(201).json(enrichShow(db, show));
});
app.delete("/api/shows/:id", authRequired, adminRequired, (req, res) => {
  const db = readDb();
  if (db.bookings.some(b => b.showId === req.params.id && b.status === "confirmed")) return res.status(409).json({ message: "This show has confirmed bookings." });
  db.shows = db.shows.filter(s => s.id !== req.params.id); db.seats = db.seats.filter(s => s.showId !== req.params.id); writeDb(db); res.json({ message: "Show deleted." });
});
app.get("/api/shows/:id/seats", (req, res) => {
  const db = readDb(), show = db.shows.find(s => s.id === req.params.id);
  if (!show) return res.status(404).json({ message: "Show not found." });
  res.json({ show: enrichShow(db, show), seats: db.seats.filter(s => s.showId === show.id).map(s => ({ seatNumber: s.seatNumber, status: s.status })) });
});

// Booking and demo payment
app.post("/api/bookings", authRequired, async (req, res) => {
  const { showId, seats: requestedSeats, paymentMethod = "Demo checkout" } = req.body || {};
  if (!Array.isArray(requestedSeats) || requestedSeats.length < 1 || requestedSeats.length > 10) return res.status(400).json({ message: "Select between 1 and 10 seats." });
  const db = readDb(), show = db.shows.find(s => s.id === showId);
  if (!show || new Date(show.startsAt) <= new Date()) return res.status(404).json({ message: "Show unavailable." });
  const uniqueSeats = [...new Set(requestedSeats)];
  if (uniqueSeats.length !== requestedSeats.length) return res.status(400).json({ message: "Duplicate seats selected." });
  const seatRows = db.seats.filter(s => s.showId === showId && uniqueSeats.includes(s.seatNumber));
  if (seatRows.length !== uniqueSeats.length || seatRows.some(s => s.status !== "available")) return res.status(409).json({ message: "One or more seats have just been booked. Refresh the seat map." });
  const bookingId = newId(), bookingCode = "SB-" + Math.random().toString(36).slice(2,8).toUpperCase();
  const amount = show.price * uniqueSeats.length;
  const booking = { id: bookingId, bookingCode, userId: req.user.id, showId, seats: uniqueSeats, amount, status: "confirmed", paymentStatus: "paid_demo", paymentMethod, createdAt: new Date().toISOString() };
  for (const seat of seatRows) { seat.status = "booked"; seat.bookingId = bookingId; }
  db.bookings.unshift(booking);
  db.payments.unshift({ id: newId(), bookingId, userId: req.user.id, amount, method: paymentMethod, status: "paid_demo", transactionRef: "DEMO-" + newId().slice(0,8).toUpperCase(), createdAt: new Date().toISOString() });
  const enriched = enrichShow(db, show);
  notify(db, req.user.id, "Booking confirmed", `${bookingCode}: ${enriched.movie?.title || "Movie"} — seats ${uniqueSeats.join(", ")}. Demo payment ₹${amount} recorded.`);
  writeDb(db);
  const user = db.users.find(u => u.id === req.user.id);
  try { await sendEmail(user.email, "Smart Bridge booking confirmation", `Your booking ${bookingCode} is confirmed.\nMovie: ${enriched.movie?.title}\nTheater: ${enriched.theater?.name}\nSeats: ${uniqueSeats.join(", ")}\nAmount: ₹${amount}\nPayment: DEMO MODE`); } catch (e) { console.error("Email error:", e.message); }
  res.status(201).json({ booking, show: enriched, payment: db.payments[0] });
});
app.get("/api/bookings/my", authRequired, (req, res) => {
  const db = readDb();
  res.json(db.bookings.filter(b => b.userId === req.user.id).map(b => ({ ...b, show: enrichShow(db, db.shows.find(s => s.id === b.showId) || {}), payment: db.payments.find(p => p.bookingId === b.id) })));
});
app.post("/api/bookings/:id/cancel", authRequired, (req, res) => {
  const db = readDb(), booking = db.bookings.find(b => b.id === req.params.id && b.userId === req.user.id);
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  const show = db.shows.find(s => s.id === booking.showId);
  if (booking.status !== "confirmed" || !show || new Date(show.startsAt).getTime() - Date.now() < 3*60*60*1000) return res.status(400).json({ message: "Only confirmed bookings more than 3 hours before showtime can be cancelled." });
  booking.status = "cancelled"; booking.paymentStatus = "refund_demo";
  db.seats.filter(s => s.bookingId === booking.id).forEach(s => { s.status = "available"; s.bookingId = null; });
  const payment = db.payments.find(p => p.bookingId === booking.id); if (payment) payment.status = "refund_demo";
  notify(db, req.user.id, "Booking cancelled", `${booking.bookingCode} has been cancelled. Demo refund status recorded.`, "warning");
  writeDb(db); res.json({ message: "Booking cancelled. Demo refund status recorded.", booking });
});

// Watchlist
app.get("/api/watchlist", authRequired, (req, res) => {
  const db = readDb();
  res.json(db.watchlists.filter(w => w.userId === req.user.id).map(w => db.movies.find(m => m.id === w.movieId)).filter(Boolean));
});
app.post("/api/watchlist/:movieId", authRequired, (req, res) => {
  const db = readDb();
  if (!db.movies.some(m => m.id === req.params.movieId)) return res.status(404).json({ message: "Movie not found." });
  const existing = db.watchlists.find(w => w.userId === req.user.id && w.movieId === req.params.movieId);
  if (existing) db.watchlists = db.watchlists.filter(w => w.id !== existing.id);
  else db.watchlists.push({ id: newId(), userId: req.user.id, movieId: req.params.movieId, createdAt: new Date().toISOString() });
  writeDb(db); res.json({ saved: !existing });
});

// Reviews and ratings
app.get("/api/reviews", (req, res) => {
  const db = readDb(); res.json(db.reviews.filter(r => !req.query.movieId || r.movieId === req.query.movieId).map(r => ({ ...r, user: db.users.find(u => u.id === r.userId)?.name || "Movie fan", movie: db.movies.find(m => m.id === r.movieId)?.title })));
});
app.post("/api/reviews", authRequired, (req, res) => {
  const { movieId, rating, comment } = req.body || {}, score = Number(rating);
  if (!readDb().movies.some(m => m.id === movieId)) return res.status(404).json({ message: "Movie not found." });
  if (!Number.isInteger(score) || score < 1 || score > 5 || !String(comment || "").trim()) return res.status(400).json({ message: "Choose a rating from 1–5 and write a review." });
  const db = readDb();
  const old = db.reviews.find(r => r.userId === req.user.id && r.movieId === movieId);
  const review = { id: old?.id || newId(), userId: req.user.id, movieId, rating: score, comment: String(comment).trim().slice(0,1000), createdAt: new Date().toISOString() };
  if (old) Object.assign(old, review); else db.reviews.unshift(review);
  writeDb(db); res.status(old ? 200 : 201).json({ ...review, user: req.user.name });
});

// Notifications
app.get("/api/notifications", authRequired, (req, res) => res.json(readDb().notifications.filter(n => n.userId === req.user.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt))));
app.post("/api/notifications/:id/read", authRequired, (req, res) => {
  const db = readDb(), n = db.notifications.find(n => n.id === req.params.id && n.userId === req.user.id);
  if (!n) return res.status(404).json({ message: "Notification not found." });
  n.read = true; writeDb(db); res.json(n);
});

// Admin dashboard and reporting
app.get("/api/admin/summary", authRequired, adminRequired, (req, res) => {
  const db = readDb();
  res.json({
    users: db.users.length, movies: db.movies.length, theaters: db.theaters.length,
    shows: db.shows.length, bookings: db.bookings.length,
    confirmedBookings: db.bookings.filter(b => b.status === "confirmed").length,
    revenue: db.payments.filter(p => p.status === "paid_demo").reduce((sum,p) => sum + p.amount, 0),
    recentBookings: db.bookings.slice(0,8).map(b => ({ ...b, user: db.users.find(u => u.id === b.userId)?.name, show: enrichShow(db, db.shows.find(s => s.id === b.showId) || {}) }))
  });
});
app.get("/api/admin/users", authRequired, adminRequired, (req, res) => res.json(readDb().users.map(safeUser)));
app.get("/api/admin/payments", authRequired, adminRequired, (req, res) => {
  const db = readDb(); res.json(db.payments.map(p => ({ ...p, user: db.users.find(u => u.id === p.userId)?.name, booking: db.bookings.find(b => b.id === p.bookingId)?.bookingCode })));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});
const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Smart Bridge API running at http://localhost:${port}`));
