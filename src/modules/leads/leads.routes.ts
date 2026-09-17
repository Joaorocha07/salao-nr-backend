import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as controller from './leads.controller';
import { addMessageSchema, addNoteSchema, createLeadSchema, listLeadsQuerySchema, scheduleAppointmentSchema, updateLeadSchema } from './leads.schema';

export const leadsRouter = Router();

leadsRouter.use(authenticate);

leadsRouter.get('/', validate(listLeadsQuerySchema, 'query'), controller.list);
leadsRouter.get('/history', controller.history);
leadsRouter.get('/:id', controller.get);
leadsRouter.post('/', validate(createLeadSchema), controller.create);
leadsRouter.patch('/:id', validate(updateLeadSchema), controller.update);
leadsRouter.delete('/:id', controller.remove);
leadsRouter.post('/:id/schedule', validate(scheduleAppointmentSchema), controller.schedule);
leadsRouter.post('/:id/cancel-appointment', controller.cancelAppointment);
leadsRouter.post('/:id/notes', validate(addNoteSchema), controller.addNote);
leadsRouter.post('/:id/messages', validate(addMessageSchema), controller.addMessage);
leadsRouter.delete('/:id/history/:recordId', controller.deleteHistoryRecord);
