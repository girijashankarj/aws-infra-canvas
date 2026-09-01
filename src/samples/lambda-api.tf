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

# Network the workload runs in.
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = local.prefix
  }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_security_group" "lambda" {
  name        = "${local.prefix}-lambda"
  description = "Egress only"
  vpc_id      = aws_vpc.main.id
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

resource "aws_sqs_queue" "work" {
  name                       = "${local.prefix}-work"
  visibility_timeout_seconds = 60
}

resource "aws_iam_role" "exec" {
  name               = "${local.prefix}-exec"
  assume_role_policy = jsonencode({ Version = "2012-10-17" })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.prefix}-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name = "${local.prefix}-api"
  role          = aws_iam_role.exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  memory_size   = 512
  timeout       = 15

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.items.name
      QUEUE_URL  = aws_sqs_queue.work.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn = aws_sqs_queue.work.arn
  function_name    = aws_lambda_function.api.arn
  batch_size       = 10
}
