package hello;

import java.io.IOException;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.Response;

@Path("/whatever")
public class Application {

	public static String command = "run";

	@GET
	@Path("/path1")
	public Response myMethod1(@QueryParam("User Controlled") String userControlled) {
		Library.doSomething(userControlled);
		return null;
	}

	@GET
	@Path("/path2")
	public Response myMethod2(@QueryParam("User Controlled") String userControlled) {
		Runtime r = Runtime.getRuntime();
		String[] args = { "/bin/bash", "-c", command + userControlled };
		try {
			r.exec(args);
		} catch (IOException e) {
		}
		return null;
	}
}
