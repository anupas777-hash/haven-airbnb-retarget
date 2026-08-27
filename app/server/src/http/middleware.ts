import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';

export function requestId(req: any, _res:any, next: NextFunction) {
  req.id = Math.random().toString(36).slice(2,8);
  next();
}

export function errorHandler(err:any, req:Request, res:Response, _next:NextFunction) {
  console.error(`[${(req as any).id}] error`, err);
  if (err.code && err.message) {
    const status = err.status || (err.code==='NOT_FOUND'?404: err.code==='SHEET_NOT_READABLE'?422 : 400);
    return res.status(status).json({ error:{ code: err.code, message: err.message, details: err.details }});
  }
  if (err.name==='ZodError') {
    return res.status(400).json({ error:{ code:'VALIDATION_ERROR', message:'Validation failed', details: err.errors }});
  }
  return res.status(500).json({ error:{ code:'INTERNAL', message: err.message || 'Internal error' }});
}

export function accessGate(req:Request, res:Response, next:NextFunction) {
  if (!config.accessGateToken) return next();
  const token = (req.headers['x-access-token'] as string) || (req.query.token as string);
  // allow health/setup without gate? But spec says gate the tool itself
  if (req.path.startsWith('/api/webhooks')) return next();
  if (token===config.accessGateToken) return next();
  return res.status(401).json({ error:{ code:'UNAUTHORIZED', message:'Missing or invalid access token' }});
}

export function corsWithConfig(req:Request, res:Response, next:NextFunction) {
  res.header('Access-Control-Allow-Origin', config.corsOrigin === '*' ? '*' : config.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Token');
  if (req.method==='OPTIONS') return res.sendStatus(200);
  next();
}
