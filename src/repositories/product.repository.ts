import { Prisma, Product, ProductStatus } from "@prisma/client";
import { prisma } from "../configs/database.config";

export const productRepository = { //product
  findAll(): Promise<Product[]> { 
    return prisma.product.findMany({
      where: {
        status: {
          not: ProductStatus.REMOVED,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  findById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({
      where: { id },
    });
  },

  create(data: Prisma.ProductCreateInput): Promise<Product> {  //create
    return prisma.product.create({ data });
  },

  update(id: string, data: Prisma.ProductUpdateInput): Promise<Product> { 
    return prisma.product.update({
      where: { id },
      data,
    });
  },

  delete(id: string): Promise<Product> { 
    return prisma.product.delete({
      where: { id },
    });
  },
};
