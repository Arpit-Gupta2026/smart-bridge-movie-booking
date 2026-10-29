import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const dbFile = path.join(dataDir, "db.json");

const now = new Date();
const future = (days, hour = 18) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
};

export function readDb() {
  if (!fs.existsSync(dbFile)) initializeDb();
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}
export function writeDb(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), "utf8");
}
export function initializeDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(dbFile)) return;
  const adminId = uuid(), userId = uuid();
  const movies = [
    { id: uuid(), title: "Interstellar", genre: "Sci-Fi", language: "English", duration: 169, rating: 8.7, cast: "Matthew McConaughey, Anne Hathaway, Jessica Chastain", releaseDate: "2014-11-07", description: "A team travels beyond this galaxy to discover whether mankind has a future among the stars.", poster: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", featured: true },
    { id: uuid(), title: "Spider-Man: Across the Spider-Verse", genre: "Animation", language: "English", duration: 140, rating: 8.6, cast: "Shameik Moore, Hailee Steinfeld, Brian Tyree Henry", releaseDate: "2023-06-02", description: "Miles Morales returns for an adventure across the Spider-Verse.", poster: "https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg", featured: true },
    { id: uuid(), title: "Dune: Part Two", genre: "Adventure", language: "English", duration: 166, rating: 8.5, cast: "Timothée Chalamet, Zendaya, Rebecca Ferguson", releaseDate: "2024-03-01", description: "Paul Atreides unites with Chani and the Fremen while seeking revenge.", poster: "https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", featured: true },
    { id: uuid(), title: "Jawan", genre: "Action", language: "Hindi", duration: 169, rating: 7.0, cast: "Shah Rukh Khan, Nayanthara, Vijay Sethupathi", releaseDate: "2023-09-07", description: "A high-octane action thriller about a man driven by a personal mission.", poster: "https://image.tmdb.org/t/p/w500/jFt1gS4BGHlK8xt76Y81Alp4dbt.jpg", featured: false },
    { id: uuid(), title: "12th Fail", genre: "Drama", language: "Hindi", duration: 147, rating: 8.8, cast: "Vikrant Massey, Medha Shankar", releaseDate: "2023-10-27", description: "An inspiring story of perseverance and the UPSC journey.", poster: "https://image.tmdb.org/t/p/w500/kCGlIMHnOm8JPXq3rXE9xvev8Fv.jpg", featured: false },
    { id: uuid(), title: "The Batman", genre: "Crime", language: "English", duration: 176, rating: 7.8, cast: "Robert Pattinson, Zoë Kravitz, Paul Dano", releaseDate: "2022-03-04", description: "Batman investigates corruption in Gotham while pursuing the Riddler.", poster: "https://image.tmdb.org/t/p/w500/74xTEgt7R36Fpooo50r9T25onhq.jpg", featured: false }
  ];
  const theaters = [
    { id: uuid(), name: "PVR Cinemas", location: "Knowledge Park II, Greater Noida", screens: 3 },
    { id: uuid(), name: "Cinepolis Grand", location: "Pari Chowk, Greater Noida", screens: 4 },
    { id: uuid(), name: "Smart Bridge Screens", location: "Tech Zone, Greater Noida", screens: 2 }
  ];
  const shows = [];
  for (const movie of movies) {
    for (let i = 0; i < theaters.length; i++) {
      shows.push({ id: uuid(), movieId: movie.id, theaterId: theaters[i].id, screen: (i % theaters[i].screens) + 1, startsAt: future(i + 1, 14 + i * 2), price: 220 + i * 50, seatsTotal: 48, createdAt: now.toISOString() });
      shows.push({ id: uuid(), movieId: movie.id, theaterId: theaters[i].id, screen: (i % theaters[i].screens) + 1, startsAt: future(i + 2, 17 + i), price: 220 + i * 50, seatsTotal: 48, createdAt: now.toISOString() });
    }
  }
  const seats = [];
  const rows = ["A","B","C","D","E","F"];
  for (const show of shows) for (const row of rows) for (let n = 1; n <= 8; n++) seats.push({ id: uuid(), showId: show.id, seatNumber: `${row}${n}`, status: "available", bookingId: null });
  const db = {
    users: [
      { id: adminId, name: "Smart Bridge Admin", email: "arpit@gmail.com", passwordHash: bcrypt.hashSync("arpit@123", 10), role: "admin", createdAt: now.toISOString() },
      { id: userId, name: "Demo User", email: "user@smartbridge.demo", passwordHash: bcrypt.hashSync("User123!", 10), role: "user", createdAt: now.toISOString() }
    ],
    movies, theaters, shows, seats, bookings: [], payments: [], watchlists: [], reviews: [],
    notifications: [
      { id: uuid(), userId, title: "Welcome to Smart Bridge", message: "Explore movies, choose your seats and book your next movie night.", type: "info", read: false, createdAt: now.toISOString() }
    ]
  };
  writeDb(db);
}
export const newId = () => uuid();
