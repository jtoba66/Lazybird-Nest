import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = schema.parse({
            body: req.body,
            query: req.query,
            params: req.params,
        }) as any;

        // Assign parsed values back to update strict types (e.g. string -> number transformations)
        if (parsed.body) req.body = parsed.body;
        if (parsed.query) req.query = parsed.query;
        if (parsed.params) req.params = parsed.params;

        next();
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: (error as any).errors?.map((e: any) => ({
                    path: e.path.join('.'),
                    message: e.message
                })) || []
            });
        }
        next(error);
    }
};
