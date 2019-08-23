---
id: errors
title: Errors
sidebar_label: Errors
---

In addition to the HTTP response status code, known API errors are wrapped in a payload object. This aims to provide some more context into why the error happened. For example:

```json
{
  "error": {
    "code": "ErrorIdentifier",
    "message": "Human readable information"
  }
}
```

## Known errors

#### Status code: 400
```json
{
    "error": {
        "code": "BadRequest",
        "message": "Your request seems to be invalid or malformed"
    }
}
```

#### Status code: 401
```json
{
    "error": {
        "code": "Unauthorized",
        "message": "You are not authorized to access this resource"
    }
}
```

#### Status code: 402
```json
{
    "error": {
        "code": "PaymentRequired",
        "message": "You seem to have reached your plan limit"
    }
}
```

#### Status code: 404
```json
{
    "error": {
        "code": "NotFound",
        "message": "The requested resource could not be found"
    }
}
```

#### Status code: 409
```json
{
    "error": {
        "code": "AlreadyExists",
        "message": "This resource already exists"
    }
}
```

#### Status code: 413
```json
{
    "error": {
        "code": "PayloadTooLarge",
        "message": "Payload too large"
    }
}
```

#### Status code: 422
```json
{
    "error": {
        "code": "UnprocessableEntity",
        "message": "We understood the request, but are unable to process it"
    }
}
```

#### Status code: 429
```json
{
    "error": {
        "code": "TooManyRequests",
        "message": "You are sending too many requests, please try again later"
    }
}
```

#### Status code: 500
```json
{
    "error": {
        "code": "Internal",
        "message": "Something wen't wrong, that's all we know"
    }
}
```
