// ─── VERCEL BACKEND BRIDGE ──────────────────
// This file handles secure communication with Vercel KV or Blob.
// Move your code to a folder named 'api' when deploying.

import { kv } from '@vercel/kv';

export default async function handler(request, response) {
  const { method } = request;

  try {
    if (method === 'GET') {
      // Get all users for Admin
      const users = await kv.hgetall('aura_users') || {};
      return response.status(200).json(users);
    }

    if (method === 'POST') {
      // Save/Update a specific user
      const { username, data } = request.body;
      await kv.hset('aura_users', { [username]: data });
      return response.status(200).json({ success: true });
    }

    return response.status(405).end();
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
