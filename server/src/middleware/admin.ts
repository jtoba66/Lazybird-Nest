import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) return res.sendStatus(401);

    try {
        const [user] = await db.select({
            email: users.email,
            role: users.role
        })
            .from(users)
            .where(eq(users.id, req.user.userId))
            .limit(1);

        if (user && (user.role === 'admin' || user.email === 'josephtoba29@gmail.com')) {
            next();
        } else {
            res.status(403).json({ error: 'Admin access required' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
};
