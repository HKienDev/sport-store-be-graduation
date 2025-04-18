import Order from '../models/order.js';
import Product from '../models/product.js';
import User from '../models/user.js';
import { logInfo, logError } from '../utils/logger.js';
import { handleError } from '../utils/helpers.js';
import { v4 as uuidv4 } from 'uuid';

// Lấy thống kê tổng quan
export const getStats = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const [totalOrders, totalRevenue, totalCustomers, totalProducts] = await Promise.all([
            Order.countDocuments(),
            Order.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$total' } } }
            ]),
            User.countDocuments({ role: 'user' }),
            Product.countDocuments()
        ]);

        logInfo(`[${requestId}] Successfully fetched dashboard stats`);
        res.json({
            success: true,
            data: {
                totalOrders: totalOrders || 0,
                totalRevenue: totalRevenue[0]?.total || 0,
                totalCustomers: totalCustomers || 0,
                totalProducts: totalProducts || 0
            }
        });
    } catch (error) {
        logError(`[${requestId}] Error:: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Lấy doanh thu
export const getRevenue = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const revenue = await Order.aggregate([
            { $match: { status: 'completed' } },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    revenue: { $sum: '$total' }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 },
            {
                $project: {
                    _id: 0,
                    month: {
                        $concat: [
                            { $toString: '$_id.year' },
                            '-',
                            { $toString: '$_id.month' }
                        ]
                    },
                    revenue: 1
                }
            }
        ]);

        logInfo(`[${requestId}] Successfully fetched revenue data`);
        res.json({
            success: true,
            data: revenue
        });
    } catch (error) {
        logError(`[${requestId}] Error:: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Lấy đơn hàng gần đây
export const getRecentOrders = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const orders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('user', 'username email');

        logInfo(`[${requestId}] Successfully fetched recent orders`);
        res.json({
            success: true,
            data: orders.map(order => ({
                _id: order._id,
                orderNumber: order.orderNumber,
                customerName: order.user?.username || 'Unknown User',
                total: order.total,
                status: order.status,
                createdAt: order.createdAt
            }))
        });
    } catch (error) {
        logError(`[${requestId}] Error:: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Lấy sản phẩm bán chạy
export const getBestSellingProducts = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const products = await Order.aggregate([
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.product',
                    totalSales: { $sum: '$items.quantity' }
                }
            },
            { $sort: { totalSales: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: '$product' },
            {
                $project: {
                    _id: '$product._id',
                    name: '$product.name',
                    category: '$product.category',
                    totalSales: 1,
                    image: '$product.images.0'
                }
            }
        ]);

        logInfo(`[${requestId}] Successfully fetched best selling products`);
        res.json({
            success: true,
            data: products
        });
    } catch (error) {
        logError(`[${requestId}] Error:: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Thống kê sản phẩm theo danh mục
export const getProductStatsByCategory = async (req, res) => {
    try {
        const requestId = req.id || uuidv4();
        logInfo(`[${requestId}] Bắt đầu xử lý thống kê sản phẩm theo danh mục`);

        const stats = await Product.aggregate([
            {
                $match: {
                    isDeleted: false
                }
            },
            {
                $group: {
                    _id: '$categoryId',
                    totalProducts: { $sum: 1 },
                    totalStock: { $sum: '$stock' },
                    totalSold: { $sum: '$soldCount' },
                    averagePrice: { $avg: '$salePrice' }
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: '_id',
                    foreignField: 'categoryId',
                    as: 'category'
                }
            },
            {
                $unwind: '$category'
            },
            {
                $project: {
                    _id: 0,
                    categoryId: '$_id',
                    categoryName: '$category.name',
                    totalProducts: 1,
                    totalStock: 1,
                    totalSold: 1,
                    averagePrice: 1
                }
            }
        ]);

        logInfo(`[${requestId}] Thống kê sản phẩm theo danh mục thành công`);
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        const requestId = req.id || uuidv4();
        logError(`[${requestId}] Lỗi khi thống kê sản phẩm theo danh mục: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const getDashboardStats = async (req, res) => {
    const requestId = generateRequestId();
    try {
        // ... existing code ...
        const query = {}; // Xóa isDeleted: false
        // ... existing code ...
    } catch (error) {
        // ... existing code ...
    }
}; 