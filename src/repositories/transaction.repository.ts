import { prisma } from "../configs/database.config";

type TransactionCreateData = Parameters<typeof prisma.tradeTransaction.create>[0]["data"];
type TransactionUpdateData = Parameters<typeof prisma.tradeTransaction.update>[0]["data"];
type TransactionClientLike = { 
  tradeTransaction: {
    create: typeof prisma.tradeTransaction.create;
    update: typeof prisma.tradeTransaction.update;
  };
  product: {
    update: typeof prisma.product.update;
  };
};

const transactionDetailsInclude = {
  buyer: {
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  seller: {
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      category: true,
      condition: true,
      status: true,
      location: true,
      sellerId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

export const transactionRepository = {  //transaction
  create(client: TransactionClientLike, data: TransactionCreateData) {
    return client.tradeTransaction.create({ data });
  },

  findById(transactionId: string) {
    return prisma.tradeTransaction.findUnique({
      where: { id: transactionId },
      include: transactionDetailsInclude,
    });
  },

  findBuyerTransactions(buyerId: string) {
    return prisma.tradeTransaction.findMany({
      where: { buyerId },
      include: transactionDetailsInclude,
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  findSellerTransactions(sellerId: string) {
    return prisma.tradeTransaction.findMany({
      where: { sellerId },
      include: transactionDetailsInclude,
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  updateStatus(
    client: TransactionClientLike,
    transactionId: string,
    data: TransactionUpdateData,
  ) {
    return client.tradeTransaction.update({
      where: { id: transactionId },
      data,
      include: transactionDetailsInclude,
    });
  },
};
