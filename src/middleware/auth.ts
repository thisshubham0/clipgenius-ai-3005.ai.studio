import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import firebaseConfig from '../../firebase-applet-config.json';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  credits: number;
  plan: string;
  preferencesJson: string;
  isDemo: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

const DEMO_UID = 'demo-studio-user';
const DEMO_EMAIL = 'studio-demo@clipgenius.local';
const HMAC_SECRET =
  process.env.SESSION_SECRET ||
  `${firebaseConfig.projectId}:${firebaseConfig.apiKey}:clipgenius-demo`;

export function signDemoToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: DEMO_UID, iat: Date.now() })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');
  return `demo.${payload}.${sig}`;
}

export function verifyDemoToken(token: string): boolean {
  if (!token.startsWith('demo.')) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [, payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    if (token.startsWith('demo.')) {
      if (!verifyDemoToken(token)) {
        return res.status(401).json({ error: 'Invalid studio demo session token.' });
      }
      const dbUser = await getOrCreateUser({
        uid: DEMO_UID,
        email: DEMO_EMAIL,
        displayName: 'Alex Rivera',
        photoUrl: '/src/assets/images/avatar_creator_profile_1794825184690.jpg',
      });
      req.authUser = {
        ...dbUser,
        isDemo: true,
      };
      return next();
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const dbUser = await getOrCreateUser({
      uid: decoded.uid,
      email: decoded.email ?? 'creator@clipgenius.ai',
      displayName: decoded.name ?? decoded.email?.split('@')[0] ?? 'Creator',
      photoUrl: decoded.picture ?? '',
    });
    req.authUser = {
      ...dbUser,
      isDemo: false,
    };
    return next();
  } catch (error) {
    console.error('Auth verification failed:', error);
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
};
