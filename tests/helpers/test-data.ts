import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  AuditLogModel,
  DisputeEvidenceModel,
  DisputeModel,
  LoginAttemptModel,
  OAuthAccountModel,
  OAuthExchangeCodeModel,
  OAuthStateModel,
  ProductModel,
  RecoveryCodeModel,
  TradeTransactionModel,
  UserModel,
} from "../../src/db/models";
import {
  ProductCategory,
  ProductCondition,
  ProductStatus,
  TransactionStatus,
  UserRole,
  type DisputeReason,
  type DisputeStatus,
} from "../../src/db/types";
import { env } from "../../src/configs/env.config";

let sequence = 0;

const nextValue = () => {
  sequence += 1;
  return `${Date.now()}-${sequence}`;
};

export const clearDatabase = async () => {
  await AuditLogModel.deleteMany({});
  await OAuthExchangeCodeModel.deleteMany({});
  await OAuthStateModel.deleteMany({});
  await OAuthAccountModel.deleteMany({});
  await DisputeEvidenceModel.deleteMany({});
  await DisputeModel.deleteMany({});
  await RecoveryCodeModel.deleteMany({});
  await LoginAttemptModel.deleteMany({});
  await TradeTransactionModel.deleteMany({});
  await ProductModel.deleteMany({});
  await UserModel.deleteMany({});
};

export const createUser = async ({
  email,
  password = "Password@123",
  role = UserRole.BUYER,
  username,
}: {
  email?: string;
  password?: string;
  role?: UserRole;
  username?: string;
} = {}) => {
  const unique = nextValue();
  const user = await UserModel.create({
    username: username ?? `user-${unique}`,
    email: email ?? `user-${unique}@example.com`,
    password: await bcrypt.hash(password, 10),
    role,
  });

  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    role: user.role,
    plainPassword: password,
  };
};

export const createAccessToken = (userId: string, expiresIn = env.jwtExpiresIn) =>
  jwt.sign({ userId }, env.jwtPrivateKey, {
    algorithm: "RS256",
    expiresIn,
  });

export const createUserSession = async (options: {
  email?: string;
  password?: string;
  role?: UserRole;
  username?: string;
} = {}) => {
  const user = await createUser(options);

  return {
    user,
    token: createAccessToken(user.id),
  };
};

export const createProduct = async ({
  sellerId,
  status = ProductStatus.AVAILABLE,
}: {
  sellerId: string;
  status?: ProductStatus;
}) => {
  const unique = nextValue();
  const product = await ProductModel.create({
    name: `Product ${unique}`,
    description: `Description for product ${unique}`,
    price: 999,
    category: ProductCategory.ELECTRONICS,
    condition: ProductCondition.GOOD,
    location: "Kathmandu",
    status,
    sellerId,
  });

  return {
    id: String(product._id),
    name: product.name,
    price: product.price,
    status: product.status,
  };
};

export const createTransaction = async ({
  buyerId,
  sellerId,
  productId,
  productName = `Transaction Product ${nextValue()}`,
  agreedPrice = 999,
  status = TransactionStatus.FUNDS_HELD,
}: {
  buyerId: string;
  sellerId: string;
  productId: string;
  productName?: string;
  agreedPrice?: number;
  status?: TransactionStatus;
}) => {
  const transaction = await TradeTransactionModel.create({
    buyerId,
    sellerId,
    productId,
    productName,
    agreedPrice,
    status,
  });

  return {
    id: String(transaction._id),
    productId: String(transaction.productId),
    status: transaction.status,
  };
};

export const createDispute = async ({
  transactionId,
  raisedById,
  previousTransactionStatus = TransactionStatus.SHIPPED,
  reason = "ITEM_NOT_RECEIVED" as DisputeReason,
  description = "The item has not been received and I need help.",
  status = "OPEN" as DisputeStatus,
}: {
  transactionId: string;
  raisedById: string;
  previousTransactionStatus?: TransactionStatus;
  reason?: DisputeReason;
  description?: string;
  status?: DisputeStatus;
}) => {
  const dispute = await DisputeModel.create({
    transactionId,
    raisedById,
    reason,
    description,
    status,
    previousTransactionStatus,
  });

  return {
    id: String(dispute._id),
  };
};
