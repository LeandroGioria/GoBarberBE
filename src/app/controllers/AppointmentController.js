import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';
import Appointment from '../models/Appointment';
import User from '../models/User';
import File from '../models/File';
import Notification from '../schemas/notification';
import Queue from '../../lib/Queue';
import CancellationMail from '../jobs/CancellationMail';

class AppointmentController {
    async index(req, res) {
        const { page = 1 } = req.query;
        const appointments = await Appointment.findAll({
            where: {
                user_id: req.userId,
                canceled_at: null,
            },
            order: ['date'],
            limit: 20,
            offset: (page - 1) * 20,
            attributes: ['id', 'date', 'past', 'cancelable'],
            include: [
                {
                    model: User,
                    as: 'provider',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: File,
                            as: 'avatar',
                            attributes: ['path', 'url'],
                        },
                    ],
                },
            ],
        });

        return res.json(appointments);
    }

    async store(req, res) {
        const schema = Yup.object().shape({
            date: Yup.date().required(),
            provider_id: Yup.number().required(),
        });

        if (!schema.isValid(req.body)) {
            return res.status(400).json({ error: 'Validation fails' });
        }

        const { provider_id, date } = req.body;
        /**
         * Check if provider id is the same as user id
         */

        if (req.userId === provider_id) {
            return res.status(401).json({
                error: 'Cannot create appointmens for yourself',
            });
        }

        /**
         * Check if provider_id a provider
         */
        const isProvider = await User.findOne({
            where: { id: provider_id, provider: true },
        });

        if (!isProvider) {
            return res.status(401).json({
                error: 'We can only create appointments with providers',
            });
        }

        /**
         * Check for past dates
         */
        const houseStart = startOfHour(parseISO(date));

        if (isBefore(houseStart, new Date())) {
            return res
                .status(400)
                .json({ error: 'Past dates are not permitted' });
        }

        /**
         * Check date availability
         */

        const checkAvailability = await Appointment.findOne({
            where: {
                provider_id,
                canceled_at: null,
                date: houseStart,
            },
        });

        if (checkAvailability) {
            return res
                .status(400)
                .json({ error: 'Appointment date is not available' });
        }

        const appointment = await Appointment.create({
            user_id: req.userId,
            provider_id,
            date: houseStart,
        });

        /**
         * Notify appointment provider
         */

        const user = await User.findByPk(req.userId);
        const formattedDate = format(
            houseStart,
            "'dia' dd 'de' MMMM', às' H:mm'h'",
            { locale: pt }
        );

        await Notification.create({
            content: `Novo agendamento de ${user.name} para ${formattedDate}`,
            user: provider_id,
        });

        return res.json(appointment);
    }

    async delete(req, res) {
        const appointment = await Appointment.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    as: 'provider',
                    attributes: ['name', 'email'],
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['name'],
                },
            ],
        });

        if (!appointment) {
            return res
                .status(400)
                .json({ error: 'Appointment does not exists' });
        }

        if (appointment.canceled_at !== null) {
            return res
                .status(400)
                .json({ error: 'Appointment already canceled' });
        }

        if (appointment.user_id !== req.userId) {
            return res.status(401).json({
                error: "You don't have permission to cancel this appoiment",
            });
        }

        const dataWithSub = subHours(appointment.date, 2);

        if (isBefore(dataWithSub, new Date())) {
            return res.status(400).json({
                error: 'You can only cancel appointments 2 hours in advance.',
            });
        }

        appointment.canceled_at = new Date();

        await appointment.save();

        await Queue.add(CancellationMail.key, {
            appointment,
        });

        return res.json(appointment);
    }
}

export default new AppointmentController();
