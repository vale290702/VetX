import assert from "node:assert/strict";
import { test } from "node:test";
import { Body, Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IsString } from "class-validator";
import { configureHttp } from "../dist/http.js";

class ValidationInput {}
IsString()(ValidationInput.prototype, "name");

class ValidationController {
  validate(body) {
    return body;
  }
}
Controller()(ValidationController);
const handler = Object.getOwnPropertyDescriptor(ValidationController.prototype, "validate");
Post("validate")(ValidationController.prototype, "validate", handler);
Body()(ValidationController.prototype, "validate", 0);
Reflect.defineMetadata(
  "design:paramtypes",
  [ValidationInput],
  ValidationController.prototype,
  "validate",
);

class ValidationModule {}
Module({ controllers: [ValidationController] })(ValidationModule);

test("global validation rejects unknown fields without reflecting supplied data", async () => {
  const app = await NestFactory.create(ValidationModule, { logger: false });
  configureHttp(app);
  try {
    await app.listen(0, "127.0.0.1");
    const response = await fetch((await app.getUrl()) + "/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Valid string", unexpected: "sensitive value" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request",
        requestId: response.headers.get("x-request-id"),
      },
    });
  } finally {
    await app.close();
  }
});
