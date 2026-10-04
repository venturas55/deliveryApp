import { createHash, randomBytes, randomUUID } from "node:crypto";
import { transaction } from "../db.js";
import {
  signAdminAccessToken,
  signCustomerAccessToken,
} from "../auth.js";

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken() {
  return randomBytes(32).toString("base64url");
}

export function isValidRefreshToken(token) {
  return typeof token === "string" && REFRESH_TOKEN_PATTERN.test(token);
}

async function findSessionUser(connection, role, userId) {
  if (role === "customer") {
    const rows = await connection.query(
      "SELECT id FROM customers WHERE id=?",
      [userId],
    );
    return rows[0] || null;
  }
  const rows = await connection.query(
    `SELECT admins.id, admins.restaurant_id, restaurants.active AS restaurant_active
     FROM admins
     JOIN restaurants ON restaurants.id=admins.restaurant_id
     WHERE admins.id=?`,
    [userId],
  );
  if (!rows[0] || Number(rows[0].restaurant_active) !== 1) return null;
  return rows[0];
}

function accessToken(role, user) {
  return role === "admin"
    ? signAdminAccessToken(user)
    : signCustomerAccessToken(user);
}

async function insertRefreshToken(connection, { role, userId, familyId, token }) {
  await connection.query(
    `INSERT INTO auth_refresh_tokens
      (family_id, role, subject_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [familyId, role, userId, tokenHash(token)],
  );
}

export async function createAuthSession(role, userId) {
  if (role !== "customer" && role !== "admin")
    throw new TypeError("Invalid authentication role");

  const refreshToken = newRefreshToken();
  const familyId = randomUUID();
  return transaction(async (connection) => {
    const user = await findSessionUser(connection, role, userId);
    if (!user) return null;
    await insertRefreshToken(connection, {
      role,
      userId: user.id,
      familyId,
      token: refreshToken,
    });
    return { accessToken: accessToken(role, user), refreshToken };
  });
}

export async function rotateAuthSession(refreshToken) {
  if (!isValidRefreshToken(refreshToken)) return null;
  const hash = tokenHash(refreshToken);

  return transaction(async (connection) => {
    const rows = await connection.query(
      `SELECT id, family_id, role, subject_id, revoked_at,
              expires_at > NOW() AS unexpired
       FROM auth_refresh_tokens
       WHERE token_hash=?
       FOR UPDATE`,
      [hash],
    );
    const current = rows[0];
    if (!current) return null;

    if (current.revoked_at || Number(current.unexpired) !== 1) {
      await connection.query(
        `UPDATE auth_refresh_tokens
         SET revoked_at=COALESCE(revoked_at, NOW())
         WHERE family_id=? AND revoked_at IS NULL`,
        [current.family_id],
      );
      return null;
    }

    const user = await findSessionUser(
      connection,
      current.role,
      current.subject_id,
    );
    if (!user) {
      await connection.query(
        `UPDATE auth_refresh_tokens
         SET revoked_at=COALESCE(revoked_at, NOW())
         WHERE family_id=? AND revoked_at IS NULL`,
        [current.family_id],
      );
      return null;
    }

    const replacement = newRefreshToken();
    await connection.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at=NOW(), last_used_at=NOW()
       WHERE id=? AND revoked_at IS NULL`,
      [current.id],
    );
    await insertRefreshToken(connection, {
      role: current.role,
      userId: user.id,
      familyId: current.family_id,
      token: replacement,
    });
    return {
      accessToken: accessToken(current.role, user),
      refreshToken: replacement,
    };
  });
}

export async function revokeAuthSession(refreshToken) {
  if (!isValidRefreshToken(refreshToken)) return false;
  const hash = tokenHash(refreshToken);
  return transaction(async (connection) => {
    const result = await connection.query(
      `UPDATE auth_refresh_tokens
       SET revoked_at=COALESCE(revoked_at, NOW())
       WHERE token_hash=?`,
      [hash],
    );
    return Number(result.affectedRows) > 0;
  });
}
