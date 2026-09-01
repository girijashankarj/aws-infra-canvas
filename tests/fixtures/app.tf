terraform {
  required_version = ">= 1.5"
}

variable "stage" {
  type    = string
  default = "dev"
}

locals {
  prefix = "app-${var.stage}"
}

# The network the whole stack lives in.
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = local.prefix
  }
}

resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id # nested inside the VPC
  cidr_block = "10.0.10.0/24"
}

resource "aws_dynamodb_table" "items" {
  name         = "${local.prefix}-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }
}

resource "aws_iam_role" "exec" {
  name               = "${local.prefix}-exec"
  assume_role_policy = jsonencode({ Version = "2012-10-17" })
}

resource "aws_lambda_function" "api" {
  function_name = "${local.prefix}-api"
  role          = aws_iam_role.exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  memory_size   = 256

  vpc_config {
    subnet_ids = [aws_subnet.private.id]
  }

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.items.name
    }
  }

  depends_on = [aws_iam_role.exec]
}
