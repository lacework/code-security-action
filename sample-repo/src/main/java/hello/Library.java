package hello;

import java.io.IOException;
import java.io.InputStream;

public class Library {
	public static void doSomething(InputStream is) {
		execute(is.toString());
	}

	private static void execute(String command) {
		try {
			Runtime.getRuntime().exec(command);
		} catch (IOException e) {
			// do nothing
		}

	}
}
