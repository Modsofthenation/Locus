import { describe, expect, it } from "vitest";
import { awsQueryResult, awsXmlError, parseAwsXml } from "./awsXml.js";

describe("parseAwsXml", () => {
  it("reads GetCallerIdentity", () => {
    const body = parseAwsXml(`<?xml version="1.0"?>
      <GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
        <GetCallerIdentityResult>
          <Arn>arn:aws:iam::123:user/alice</Arn>
          <UserId>AIDA</UserId>
          <Account>123</Account>
        </GetCallerIdentityResult>
      </GetCallerIdentityResponse>`);
    expect(awsQueryResult(body, "GetCallerIdentity")).toEqual({
      Arn: "arn:aws:iam::123:user/alice",
      UserId: "AIDA",
      Account: "123",
    });
  });

  it("collapses IAM member lists", () => {
    const body = parseAwsXml(`
      <ListUsersResponse>
        <ListUsersResult>
          <Users>
            <member><UserName>alice</UserName><Arn>arn:a</Arn></member>
            <member><UserName>bob</UserName><Arn>arn:b</Arn></member>
          </Users>
          <IsTruncated>false</IsTruncated>
        </ListUsersResult>
      </ListUsersResponse>`);
    expect(awsQueryResult(body, "ListUsers")).toEqual({
      Users: [
        { UserName: "alice", Arn: "arn:a" },
        { UserName: "bob", Arn: "arn:b" },
      ],
      IsTruncated: "false",
    });
  });

  it("formats IAM error XML", () => {
    expect(
      awsXmlError(
        `<ErrorResponse><Error><Code>AccessDenied</Code><Message>not allowed</Message></Error></ErrorResponse>`,
        "GetUser",
        403,
      ),
    ).toBe("AWS GetUser failed: AccessDenied: not allowed");
  });
});
