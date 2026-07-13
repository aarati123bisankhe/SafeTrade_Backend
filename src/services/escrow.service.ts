import { Prisma, ProductStatus } from "@prisma/client";
import { HttpError } from "../errors/http-error";

type PrismaExecutor = Pick<Prisma.TransactionClient, "product">;

export const escrowService = { //escrow
  async reserveProduct(executor: PrismaExecutor, productId: string) {
    const result = await executor.product.updateMany({
      where: {
        id: productId,
        status: ProductStatus.AVAILABLE,
      },
      data: {
        status: ProductStatus.RESERVED,
      },
    });

    if (result.count !== 1) {
      throw new HttpError(409, "Product is no longer available for purchase");
    }
  },
};
