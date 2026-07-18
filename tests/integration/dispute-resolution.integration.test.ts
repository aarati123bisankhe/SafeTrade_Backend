import request from "supertest";
import { app } from "../../src/app";
import {
  connectDatabase,
  disconnectDatabase,
} from "../../src/configs/database.config";
import { ProductModel, TradeTransactionModel } from "../../src/db/models";
import {
  ProductStatus,
  TransactionStatus,
  UserRole,
} from "../../src/db/types";
import {
  clearDatabase,
  createDispute,
  createProduct,
  createTransaction,
  createUser,
  createUserSession,
} from "../helpers/test-data";

describe("Dispute resolution", () => {
  beforeAll(async () => {
    await connectDatabase();
  }, 15000);

  beforeEach(async () => {
    await clearDatabase();
  }, 15000);

  afterAll(async () => {
    await clearDatabase();
    await disconnectDatabase();
  }, 15000);

  it("admin can refund buyer when dispute contains populated transaction data", async () => {
    const admin = await createUserSession({ role: UserRole.ADMIN });
    const seller = await createUser({ role: UserRole.SELLER });
    const buyer = await createUser({ role: UserRole.BUYER });
    const product = await createProduct({
      sellerId: seller.id,
      status: ProductStatus.RESERVED,
    });
    const transaction = await createTransaction({
      buyerId: buyer.id,
      sellerId: seller.id,
      productId: product.id,
      productName: "Refundable product",
      agreedPrice: 2500,
      status: TransactionStatus.DISPUTED,
    });
    const dispute = await createDispute({
      transactionId: transaction.id,
      raisedById: buyer.id,
      previousTransactionStatus: TransactionStatus.SHIPPED,
      status: "UNDER_REVIEW",
    });

    const response = await request(app)
      .patch(`/api/disputes/${dispute.id}/resolve`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        decision: "REFUND_BUYER",
        adminNote: "Refund approved after review.",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("RESOLVED_BUYER");
    expect(response.body.data.transaction.status).toBe("BUYER_REFUNDED");
    expect(response.body.data.transaction.id).toBe(transaction.id);

    const updatedTransaction = await TradeTransactionModel.findById(transaction.id).lean();
    const updatedProduct = await ProductModel.findById(product.id).lean();

    expect(updatedTransaction?.status).toBe(TransactionStatus.BUYER_REFUNDED);
    expect(updatedProduct?.status).toBe(ProductStatus.AVAILABLE);
  });

  it("admin can release funds to seller", async () => {
    const admin = await createUserSession({ role: UserRole.ADMIN });
    const seller = await createUser({ role: UserRole.SELLER });
    const buyer = await createUser({ role: UserRole.BUYER });
    const product = await createProduct({
      sellerId: seller.id,
      status: ProductStatus.RESERVED,
    });
    const transaction = await createTransaction({
      buyerId: buyer.id,
      sellerId: seller.id,
      productId: product.id,
      productName: "Sellable product",
      agreedPrice: 3200,
      status: TransactionStatus.DISPUTED,
    });
    const dispute = await createDispute({
      transactionId: transaction.id,
      raisedById: buyer.id,
      previousTransactionStatus: TransactionStatus.SHIPPED,
      status: "UNDER_REVIEW",
    });

    const response = await request(app)
      .patch(`/api/disputes/${dispute.id}/resolve`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        decision: "RELEASE_SELLER",
        adminNote: "Seller evidence is sufficient.",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("RESOLVED_SELLER");
    expect(response.body.data.transaction.status).toBe("FUNDS_RELEASED");

    const updatedTransaction = await TradeTransactionModel.findById(transaction.id).lean();
    const updatedProduct = await ProductModel.findById(product.id).lean();

    expect(updatedTransaction?.status).toBe(TransactionStatus.FUNDS_RELEASED);
    expect(updatedProduct?.status).toBe(ProductStatus.SOLD);
  });
});
