import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerEmployeeSchema,
  registerSchema,
  resetPasswordSchema,
  selectCompanySchema,
  switchCompanySchema,
} from './auth.schema';

export const authRouter = Router();

authRouter.get('/companies/public', controller.publicCompanies);

authRouter.post('/register', authRateLimiter, validate(registerSchema), controller.register);
authRouter.post('/register-employee', authRateLimiter, validate(registerEmployeeSchema), controller.registerEmployee);
authRouter.post('/google', authRateLimiter, validate(googleAuthSchema), controller.googleAuth);
authRouter.post('/login', authRateLimiter, validate(loginSchema), controller.login);
authRouter.post('/login/company', authRateLimiter, validate(selectCompanySchema), controller.selectCompany);
authRouter.post('/refresh', authRateLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
authRouter.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), controller.resetPassword);

authRouter.get('/me', authenticate, controller.me);
authRouter.get('/companies', authenticate, controller.myCompanies);
authRouter.post('/switch-company', authenticate, validate(switchCompanySchema), controller.switchCompany);
authRouter.post('/change-password', authenticate, validate(changePasswordSchema), controller.changePassword);
