import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  DisputeReason,
  DisputeStatus,
  Prisma,
  ProductCategory,
  ProductCondition,
  ProductStatus,
  TransactionStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "../../src/configs/database.config";

type CreateUserOptions = {
  email?: string;
  password?: string;
  role?: UserRole;
  username?: string;
};

type CreateProductOptions = {
  sellerId: string;
  status?: ProductStatus;
};

type CreateTransactionOptions = {
  buyerId: string;
  sellerId: string;
  productId: string;
  productName?: string;
  agreedPrice?: Prisma.Decimal | number | string;
  status?: TransactionStatus;
};

type CreateDisputeOptions = {
  transactionId: string;
  raisedById: string;
  previousTransactionStatus?: TransactionStatus;
  reason?: DisputeReason;
  description?: string;
  status?: DisputeStatus;
  resolvedById?: string;
  adminNote?: string;
  resolvedAt?: Date;
};

let sequence = 0;

const nextValue = () => {
  sequence += 1;
  return `${Date.now()}-${sequence}`;
};

export const clearDatabase = async () => {
  await prisma.auditLog.deleteMany();
  await prisma.disputeEvidence.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.tradeTransaction.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
};

export const createUser = async ({
  email,
  password = "password123",
  role = UserRole.BUYER,
  username,
}: CreateUserOptions = {}) => {
  const unique = nextValue();

  const user = await prisma.user.create({
    data: {
      username: username ?? `user-${unique}`,
      email: email ?? `user-${unique}@example.com`,
      password: await bcrypt.hash(password, 10),
      role,
    },
  });

  return {
    ...user,
    plainPassword: password,
  };
};

export const createAccessToken = (
  userId: string,
  expiresIn: string | number = "7d",
) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET ?? "test-secret",
    { expiresIn } as jwt.SignOptions,
  );
};

export const createUserSession = async (options: CreateUserOptions = {}) => {
  const user = await createUser(options);

  return {
    user,
    token: createAccessToken(user.id),
  };
};

export const createProduct = async ({
  sellerId,
  status = ProductStatus.AVAILABLE,
}: CreateProductOptions) => {
  const unique = nextValue();

  return prisma.product.create({
    data: {
      name: `Product ${unique}`,
      description: `Description for product ${unique}`,
      price: new Prisma.Decimal(99.99),
      category: ProductCategory.ELECTRONICS,
      condition: ProductCondition.GOOD,
      location: "Kathmandu",
      status,
      sellerId,
    },
  });
};

export const createTransaction = async ({
  buyerId,
  sellerId,
  productId,
  productName = `Transaction Product ${nextValue()}`,
  agreedPrice = new Prisma.Decimal(99.99),
  status = TransactionStatus.FUNDS_HELD,
}: CreateTransactionOptions) => {
  return prisma.tradeTransaction.create({
    data: {
      buyerId,
      sellerId,
      productId,
      productName,
      agreedPrice,
      status,
    },
  });
};

export const createDispute = async ({
  transactionId,
  raisedById,
  previousTransactionStatus = TransactionStatus.SHIPPED,
  reason = DisputeReason.ITEM_NOT_RECEIVED,
  description = "The item has not been received and I need help.",
  status = DisputeStatus.OPEN,
  resolvedById,
  adminNote,
  resolvedAt,
}: CreateDisputeOptions) => {
  return prisma.dispute.create({
    data: {
      transactionId,
      raisedById,
      reason,
      description,
      status,
      previousTransactionStatus,
      resolvedById,
      adminNote,
      resolvedAt,
    },
  });
};
