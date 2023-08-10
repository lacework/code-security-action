package hello;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.Response;

@Path("/whatever")
public class Application {

	@GET
	@Path("/path")
	public Response myMethod(@QueryParam("User Controlled") String userControlled) {
		Library.doSomething(userControlled);
		return null;
	}
}
