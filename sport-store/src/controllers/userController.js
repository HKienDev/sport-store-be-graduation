import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Order from "../models/order.js";
import jwt from "jsonwebtoken";
import { logInfo, logError } from "../utils/logger.js";
import env from "../config/env.js";
import { ERROR_MESSAGES, SUCCESS_MESSAGES, USER_ROLES, USER_STATUS, USER_CONFIG, TOKEN_CONFIG } from "../utils/constants.js";
import { handleError, setAuthCookies } from "../utils/helpers.js";
import { generateTokens } from "./authController.js";
import { sendEmail } from "../utils/sendEmail.js";
import { AUTH_CONFIG } from "../utils/constants.js";
import { generateOTP } from "../utils/helpers.js";
import { getRedisClient } from "../config/redis.js";

// Helper functions
const hashPassword = (password) => bcrypt.hash(password, 10);

const formatUserResponse = (user) => {
    return {
        _id: user._id,
        email: user.email,
        username: user.username,
        fullname: user.fullname,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
        address: user.address,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    };
};

// Controllers
export const getUsers = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { page = 1, limit = 10, sort = 'createdAt', order = 'desc' } = req.query;
        const skip = (page - 1) * limit;

        const users = await User.find()
            .select('-password')
            .sort({ [sort]: order === 'desc' ? -1 : 1 })
            .skip(skip)
            .limit(limit);

        const total = await User.countDocuments();

        logInfo(`[${requestId}] Successfully retrieved users`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USERS_RETRIEVED,
            data: {
                users: users.map(formatUserResponse),
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const getUserById = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const user = await User.findById(req.params.id).select('-password');
        
        if (!user) {
            logError(`[${requestId}] User not found: ${req.params.id}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        logInfo(`[${requestId}] Successfully retrieved user: ${user.name}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_RETRIEVED,
            data: formatUserResponse(user)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateUser = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { email, username, password, otp } = req.body;
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        const redis = getRedisClient();
        if (!redis) {
            throw new Error('Redis connection not available');
        }

        // Kiểm tra OTP
        const otpKey = `otp:update:${email}`;
        const storedOTP = await redis.get(otpKey);
        
        if (!storedOTP) {
            logError(`[${requestId}] Invalid or expired OTP for: ${email}`);
            return res.status(400).json({ 
                success: false,
                message: ERROR_MESSAGES.OTP_INVALID 
            });
        }

        if (storedOTP !== otp) {
            logError(`[${requestId}] Incorrect OTP for: ${email}`);
            return res.status(400).json({ 
                success: false,
                message: ERROR_MESSAGES.OTP_INCORRECT 
            });
        }

        // Cập nhật thông tin
        if (email) user.email = email;
        if (username) user.username = username;
        if (password) user.password = await hashPassword(password);

        await user.save();
        await redis.del(otpKey);

        logInfo(`[${requestId}] User updated: ${userId}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_UPDATED,
            data: {
                email: user.email,
                username: user.username,
                role: user.role,
                isVerified: user.isVerified
            }
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const deleteUser = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const userId = req.params.id;

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        await user.deleteOne();

        logInfo(`[${requestId}] Successfully deleted user: ${user.name}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_DELETED
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateUserRole = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { role } = req.body;
        const userId = req.params.id;

        if (!Object.values(USER_ROLES).includes(role)) {
            logError(`[${requestId}] Invalid user role: ${role}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_USER_ROLE
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        user.role = role;
        await user.save();

        logInfo(`[${requestId}] Successfully updated user role: ${user.name}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_ROLE_UPDATED,
            data: formatUserResponse(user)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateUserStatus = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { status } = req.body;
        const userId = req.params.id;

        if (!['active', 'inactive'].includes(status)) {
            logError(`[${requestId}] Invalid user status: ${status}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_USER_STATUS
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        user.status = status;
        await user.save();

        logInfo(`[${requestId}] Successfully updated user status: ${user.name}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_STATUS_UPDATED,
            data: formatUserResponse(user)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const { username, fullname, phone, address, dob, gender } = req.body;
        const user = await User.findById(req.user._id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        // Cập nhật thông tin
        user.username = username || user.username;
        user.fullname = fullname || user.fullname;
        user.phone = phone || user.phone;
        user.address = address || user.address;
        user.dob = dob || user.dob;
        user.gender = gender || user.gender;

        await user.save();
        
        res.status(200).json({
            success: true,
            message: SUCCESS_MESSAGES.PROFILE_UPDATED,
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
};

export const register = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { email, password, username, isAdminCreate } = req.body;

        if (isAdminCreate && req.user.role !== "admin") {
            logError(`[${requestId}] Unauthorized admin creation attempt`);
            return res.status(403).json({
                success: false,
                message: ERROR_MESSAGES.UNAUTHORIZED
            });
        }

        if (!email || !password || !username) {
            logError(`[${requestId}] Missing required fields`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_FIELDS
            });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            logError(`[${requestId}] Email already exists: ${email}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.EMAIL_EXISTS
            });
        }

        const hashedPassword = await hashPassword(password);

        const newUser = new User({
            email,
            password: hashedPassword,
            username,
            role: "user",
            isVerified: isAdminCreate ? true : false,
            authStatus: isAdminCreate ? "verified" : "pending",
            address: { province: "", district: "", ward: "", street: "" },
            dob: null,
            gender: "other",
            membershipLevel: "Hạng Sắt",
            totalSpent: 0,
            orderCount: 0
        });

        const savedUser = await newUser.save();

        logInfo(`[${requestId}] Successfully created new user: ${email}`);
        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.USER_CREATED,
            data: formatUserResponse(savedUser)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateUserByAdmin = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            logError(`[${requestId}] Invalid ID format: ${req.params.id}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_ID
            });
        }

        let { 
            password, 
            fullname, 
            username, 
            phone, 
            avatar, 
            role, 
            address, 
            dob, 
            gender, 
            isActive,
            authStatus,
            membershipLevel,
            totalSpent
        } = req.body;

        const updateFields = {};

        if (fullname) updateFields.fullname = fullname;
        if (username) updateFields.username = username;
        if (phone) updateFields.phone = phone;
        if (avatar) updateFields.avatar = avatar;
        if (role) updateFields.role = role;
        if (dob) updateFields.dob = dob;
        if (gender) updateFields.gender = gender;
        if (typeof isActive === "boolean") updateFields.isActive = isActive;
        if (authStatus) updateFields.authStatus = authStatus;
        if (membershipLevel) updateFields.membershipLevel = membershipLevel;
        if (typeof totalSpent === "number") updateFields.totalSpent = totalSpent;

        if (password) {
            updateFields.password = await hashPassword(password);
        }

        if (address) {
            updateFields.address = {
                province: address.province || "",
                district: address.district || "",
                ward: address.ward || "",
                street: address.street || "",
            };
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateFields,
            { new: true }
        ).select("-__v -password -refreshToken -otp -otpExpires -resetPasswordToken -resetPasswordExpires");

        if (!updatedUser) {
            logError(`[${requestId}] User not found: ${req.params.id}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        logInfo(`[${requestId}] Successfully updated user: ${updatedUser.email}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.USER_UPDATED,
            data: formatUserResponse(updatedUser)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const createNewAdmin = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { email, password, username } = req.body;

        // Kiểm tra email đã tồn tại chưa
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            logError(`[${requestId}] Email already exists: ${email}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.EMAIL_EXISTS
            });
        }

        // Mã hóa mật khẩu
        const hashedPassword = await hashPassword(password);

        // Tạo user mới với role admin
        const newAdmin = new User({
            email,
            password: hashedPassword,
            username,
            role: "admin",
            isVerified: true,
            authStatus: "verified"
        });

        const savedAdmin = await newAdmin.save();

        logInfo(`[${requestId}] Successfully created new admin: ${email}`);
        res.status(201).json({
            success: true,
            message: SUCCESS_MESSAGES.ADMIN_CREATED,
            data: {
                email: savedAdmin.email,
                username: savedAdmin.username,
                role: savedAdmin.role
            }
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const getUserByPhone = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { phone } = req.params;
        if (!phone) {
            logError(`[${requestId}] Phone number is required`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_PHONE
            });
        }

        const user = await User.findOne({ phone })
            .select("-__v -password -refreshToken -otp -otpExpires -resetPasswordToken -resetPasswordExpires")
            .lean();

        if (!user) {
            logError(`[${requestId}] User not found with phone: ${phone}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        logInfo(`[${requestId}] Successfully fetched user by phone: ${phone}`);
        res.json({
            success: true,
            data: formatUserResponse(user)
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateAllUsersOrderCount = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const users = await User.find();
        for (const user of users) {
            const orderCount = await Order.countDocuments({ user: user._id });
            user.orderCount = orderCount;
            await user.save();
        }

        logInfo(`[${requestId}] Successfully updated order count for all users`);
        res.json({
            success: true,
            message: "Đã cập nhật số đơn hàng cho tất cả người dùng"
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const updateUserTotalSpent = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            logError(`[${requestId}] Invalid user ID: ${userId}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_ID
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        const orders = await Order.find({ 
            user: userId,
            status: "completed"
        });

        let totalSpent = 0;
        for (const order of orders) {
            totalSpent += order.totalPrice;
        }

        user.totalSpent = totalSpent;
        user.updateMembershipLevel();
        await user.save();

        logInfo(`[${requestId}] Successfully updated total spent for user: ${user.email}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.MEMBERSHIP_UPDATED,
            data: {
                totalSpent: user.totalSpent,
                membershipLevel: user.membershipLevel
            }
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const resetUserPassword = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        if (req.user.role !== "admin") {
            logError(`[${requestId}] Unauthorized password reset attempt`);
            return res.status(403).json({
                success: false,
                message: ERROR_MESSAGES.UNAUTHORIZED
            });
        }

        const { userId } = req.params;
        const { newPassword } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            logError(`[${requestId}] Invalid user ID: ${userId}`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_ID
            });
        }

        if (!newPassword) {
            logError(`[${requestId}] New password is required`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_FIELDS
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            logError(`[${requestId}] User not found: ${userId}`);
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        user.password = newPassword;
        await user.save();

        logInfo(`[${requestId}] Successfully reset password for user: ${user.email}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.PASSWORD_RESET
        });
    } catch (error) {
        const errorResponse = handleError(error, requestId);
        res.status(500).json(errorResponse);
    }
};

export const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: ERROR_MESSAGES.USER_NOT_FOUND
            });
        }

        // Kiểm tra mật khẩu hiện tại
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_PASSWORD
            });
        }

        // Cập nhật mật khẩu mới
        user.password = newPassword;
        await user.save();

        res.status(200).json({
            success: true,
            message: SUCCESS_MESSAGES.PASSWORD_CHANGED
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR
        });
    }
};

export const login = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            logError(`[${requestId}] Missing required fields`);
            return res.status(400).json({
                success: false,
                message: ERROR_MESSAGES.MISSING_FIELDS
            });
        }

        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            logError(`[${requestId}] User not found: ${email}`);
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS,
                errors: [
                    { field: 'email', message: 'Email hoặc mật khẩu không chính xác' }
                ]
            });
        }

        if (!user.isActive) {
            logError(`[${requestId}] Account inactive: ${email}`);
            return res.status(403).json({
                success: false,
                message: ERROR_MESSAGES.ACCOUNT_INACTIVE
            });
        }

        if (user.isBlocked) {
            logError(`[${requestId}] Account blocked: ${email}`);
            return res.status(403).json({
                success: false,
                message: ERROR_MESSAGES.ACCOUNT_BLOCKED
            });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            logError(`[${requestId}] Invalid password for user: ${email}`);
            return res.status(401).json({
                success: false,
                message: ERROR_MESSAGES.INVALID_CREDENTIALS,
                errors: [
                    { field: 'password', message: 'Email hoặc mật khẩu không chính xác' }
                ]
            });
        }

        // Cập nhật thời gian đăng nhập cuối
        user.lastLogin = new Date();
        await user.save();

        // Tạo tokens
        const { accessToken, refreshToken } = generateTokens(user._id, user.email);
        user.refreshToken = refreshToken;
        await user.save();

        // Set cookies
        setAuthCookies(res, accessToken, refreshToken);

        logInfo(`[${requestId}] Successfully logged in user: ${email}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGIN_SUCCESS,
            data: {
                email: user.email,
                username: user.username,
                fullname: user.fullname,
                phone: user.phone,
                role: user.role,
                isVerified: user.isVerified,
                authStatus: user.authStatus
            }
        });
    } catch (error) {
        logError(`[${requestId}] Login failed: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR,
            errors: [
                { message: error.message }
            ]
        });
    }
};

export const logout = async (req, res) => {
    const requestId = req.id || 'unknown';
    
    try {
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (user) {
            user.refreshToken = null;
            await user.save();
        }

        // Xóa tất cả cookies
        res.clearCookie("accessToken", {
            httpOnly: true,
            secure: env.NODE_ENV === "production",
            sameSite: "lax",
            path: '/',
            maxAge: 0
        });

        res.clearCookie("refreshToken", {
            httpOnly: true,
            secure: env.NODE_ENV === "production",
            sameSite: "lax",
            path: '/',
            maxAge: 0
        });

        res.clearCookie("user", {
            httpOnly: true,
            secure: env.NODE_ENV === "production",
            sameSite: "lax",
            path: '/',
            maxAge: 0
        });

        logInfo(`[${requestId}] Successfully logged out user: ${userId}`);
        res.json({
            success: true,
            message: SUCCESS_MESSAGES.LOGOUT_SUCCESS
        });
    } catch (error) {
        logError(`[${requestId}] Logout failed: ${error.message}`);
        logError(`Stack trace: ${error.stack}`);
        res.status(500).json({
            success: false,
            message: ERROR_MESSAGES.SERVER_ERROR,
            errors: [
                { message: error.message }
            ]
        });
    }
};