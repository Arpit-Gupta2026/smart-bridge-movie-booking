import jwt from "jsonwebtoken";
import { readDb } from "./db.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please log in to continue." });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-only-change-me");
    const user = readDb().users.find(u => u.id === payload.id);
    if (!user) return res.status(401).json({ message: "Account not found." });
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
}
export function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Administrator access required." });
  next();
}
