import mongoose from "mongoose";
import Order from "../models/order.js";
import Product from "../models/product.js";
import User from "../models/user.js";
import { logInfo, logError } from "../utils/logger.js";
import env from "../config/env.js";
import { ERROR_MESSAGES } from "../utils/constants.js";

// Constants
const TIME_RANGES = {
    DAY: 'day',
    MONTH: 'month',
    YEAR: 'year'
};

const TIMEZONE = 'Asia/Ho_Chi_Minh';

// Helper functions
const getDateRange = (timeRange) => {
    const today = new Date();
    today.setHours(7, 0, 0, 0); // Set to Vietnam timezone

    let startDate = new Date(today);
    let groupBy = 'day';

    switch (timeRange) {
        case TIME_RANGES.DAY:
            startDate.setDate(startDate.getDate() - 6);
            groupBy = 'day';
            break;
        case TIME_RANGES.MONTH:
            startDate.setMonth(startDate.getMonth() - 6);
            startDate.setDate(1);
            startDate.setHours(7, 0, 0, 0);
            groupBy = 'month';
            break;
        case TIME_RANGES.YEAR:
            startDate.setFullYear(startDate.getFullYear() - 6);
            startDate.setMonth(0);
            startDate.setDate(1);
            startDate.setHours(7, 0, 0, 0);
            groupBy = 'year';
            break;
        default:
            startDate.setDate(startDate.getDate() - 6);
            groupBy = 'day';
    }

    return { startDate, today, groupBy };
};

const formatDate = (date, format) => {
    return date.toLocaleString('vi-VN', {
        ...format,
        timeZone: TIMEZONE
    });
};

const getPeriodKey = (date, groupBy) => {
    switch (groupBy) {
        case 'day':
            return formatDate(date, { day: '2-digit', month: '2-digit' });
        case 'month':
            const month = formatDate(date, { month: '2-digit' });
            const year = formatDate(date, { year: 'numeric' });
            return `${month}-${year}`;
        case 'year':
            return formatDate(date, { year: 'numeric' });
        default:
            return formatDate(date, { day: '2-digit', month: '2-digit' });
    }
};

const handleError = (error, requestId) => {
    logError(`[${requestId}] Error:`, error);
    return {
        success: false,
        message: ERROR_MESSAGES.SERVER_ERROR,
        error: env.NODE_ENV === "development" ? error.message : undefined
    };
};

// Controllers
export const getStats = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        logInfo(`[${requestId}] Fetching general statistics`);

        const today = new Date();
        today.setHours(7, 0, 0, 0);
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        // Get total orders and delivering orders
        const [totalOrders, totalDeliveringOrders] = await Promise.all([
            Order.countDocuments(),
            Order.countDocuments({ status: 'shipped' })
        ]);

        // Get today's and last month's orders
        const [todayOrders, lastMonthOrders] = await Promise.all([
            Order.find({
                status: 'delivered',
                'statusHistory': {
                    $elemMatch: {
                        'status': 'delivered',
                        'updatedAt': { $gte: today }
                    }
                }
            }),
            Order.find({
                status: 'delivered',
                'statusHistory': {
                    $elemMatch: {
                        'status': 'delivered',
                        'updatedAt': { $gte: lastMonth, $lt: today }
                    }
                }
            })
        ]);

        // Calculate revenues
        const todayRevenue = todayOrders.reduce((sum, order) => sum + order.totalPrice, 0);
        const lastMonthRevenue = lastMonthOrders.reduce((sum, order) => sum + order.totalPrice, 0);
        const revenueGrowth = lastMonthRevenue > 0 
            ? ((todayRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
            : 0;

        // Get customer statistics
        const [newCustomers, lastMonthCustomers] = await Promise.all([
            User.countDocuments({ createdAt: { $gte: today } }),
            User.countDocuments({ createdAt: { $gte: lastMonth, $lt: today } })
        ]);

        const customerGrowth = lastMonthCustomers > 0
            ? ((newCustomers - lastMonthCustomers) / lastMonthCustomers * 100).toFixed(1)
            : 0;

        logInfo(`[${requestId}] Successfully fetched statistics`);
        res.json({
            success: true,
            data: {
                totalOrders,
                totalDeliveringOrders,
                todayRevenue,
                revenueGrowth: parseFloat(revenueGrowth),
                newCustomers,
                customerGrowth: parseFloat(customerGrowth)
            }
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const getRevenue = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { timeRange = TIME_RANGES.DAY } = req.query;
        
        logInfo(`[${requestId}] Fetching revenue data for time range: ${timeRange}`);

        if (!Object.values(TIME_RANGES).includes(timeRange)) {
            logError(`[${requestId}] Invalid time range: ${timeRange}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_TIME_RANGE
            });
        }

        const { startDate, today, groupBy } = getDateRange(timeRange);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Get orders for the time period
        const orders = await Order.find({
            status: 'delivered',
            'statusHistory': {
                $elemMatch: {
                    'status': 'delivered',
                    'updatedAt': {
                        $gte: startDate,
                        $lt: timeRange === TIME_RANGES.DAY ? tomorrow : new Date(today.getTime() + 24 * 60 * 60 * 1000)
                    }
                }
            }
        }).sort({ 'statusHistory.updatedAt': 1 });

        logInfo(`[${requestId}] Found ${orders.length} orders for the period`);

        // Group orders by period
        const revenueByPeriod = orders.reduce((acc, order) => {
            const deliveredStatus = order.statusHistory.find(status => status.status === 'delivered');
            const date = new Date(deliveredStatus.updatedAt);
            const periodKey = getPeriodKey(date, groupBy);

            if (!acc[periodKey]) {
                acc[periodKey] = {
                    revenue: 0,
                    orders: 0,
                    orderValues: []
                };
            }
            acc[periodKey].revenue += order.totalPrice;
            acc[periodKey].orders += 1;
            acc[periodKey].orderValues.push(order.totalPrice);
            return acc;
        }, {});

        // Add empty periods
        const currentDate = new Date(startDate);
        while (currentDate <= today) {
            const periodKey = getPeriodKey(currentDate, groupBy);
            if (!revenueByPeriod[periodKey]) {
                revenueByPeriod[periodKey] = {
                    revenue: 0,
                    orders: 0,
                    orderValues: []
                };
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Sort periods
        const sortedPeriods = Object.entries(revenueByPeriod).sort(([keyA], [keyB]) => {
            if (groupBy === 'day') {
                const [dayA, monthA] = keyA.split('-').map(Number);
                const [dayB, monthB] = keyB.split('-').map(Number);
                if (monthA !== monthB) return monthA - monthB;
                return dayA - dayB;
            }
            return keyA.localeCompare(keyB);
        });

        logInfo(`[${requestId}] Successfully processed revenue data`);
        res.json({
            success: true,
            data: sortedPeriods.map(([period, data]) => ({
                period,
                ...data
            }))
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
}; 