import { Request, Response } from "express";
import { productService } from "../services/product.service";
import {
  createProductSchema,
  updateProductSchema,
} from "../validators/product.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const productController = { 
  async getAll(_req: Request, res: Response) {
    const products = await productService.getAllProducts();

    res.status(200).json({
      success: true,
      message: "Products fetched successfully", 
      data: products,
    });
  },

  async getById(req: Request, res: Response) {
    const product = await productService.getProductById(req.params.productId);

    res.status(200).json({
      success: true,
      message: "Product fetched successfully",
      data: product,
    });
  },

  async create(req: Request, res: Response) {
    const payload = createProductSchema.parse(req.body);
    const product = await productService.createProduct(
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  },

  async update(req: Request, res: Response) {
    const payload = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(
      req.params.productId,
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  },

  async remove(req: Request, res: Response) {
    await productService.deleteProduct(
      req.params.productId,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  },
};
